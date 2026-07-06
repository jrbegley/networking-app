import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

type TokenRow = {
  outlook_access_token: string | null;
  outlook_refresh_token: string | null;
  outlook_token_expires_at: string | null;
  outlook_email: string | null;
};

/**
 * Returns a valid access token for the signed-in user, refreshing if needed.
 * Throws if the user hasn't connected Outlook.
 *
 * `db` — pass a service-role client when calling from a context with no
 * user session (cron). Defaults to the cookie-scoped client, which under
 * RLS can only read the signed-in user's own profile.
 */
async function getAccessToken(userId: string, db?: SupabaseClient): Promise<string> {
  const supabase = db ?? (await createClient());
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "outlook_access_token, outlook_refresh_token, outlook_token_expires_at, outlook_email",
    )
    .eq("id", userId)
    .single<TokenRow>();

  if (error || !profile?.outlook_access_token) {
    throw new Error("Outlook not connected. Go to Settings to connect.");
  }

  const expiresAt = profile.outlook_token_expires_at
    ? new Date(profile.outlook_token_expires_at)
    : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() < Date.now() + 60_000;

  if (!needsRefresh) {
    return profile.outlook_access_token;
  }

  if (!profile.outlook_refresh_token) {
    throw new Error("Outlook session expired. Reconnect in Settings.");
  }

  // Refresh
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_AD_AUTHORITY ?? "common"}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: profile.outlook_refresh_token,
        redirect_uri: `${getSiteUrl()}/auth/outlook/callback`,
      }),
    },
  );

  if (!tokenRes.ok) {
    throw new Error("Outlook session expired. Reconnect in Settings.");
  }

  const tokens = await tokenRes.json();
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase
    .from("profiles")
    .update({
      outlook_access_token: tokens.access_token,
      outlook_refresh_token: tokens.refresh_token ?? profile.outlook_refresh_token,
      outlook_token_expires_at: newExpiresAt,
    })
    .eq("id", userId);

  return tokens.access_token as string;
}

export type GraphDraftResult = {
  messageId: string | null;
  webLink: string | null;
  error: string | null;
};

/**
 * Creates a draft in the user's Outlook Drafts folder via Microsoft Graph.
 * The draft is NOT sent — the user reviews it in Outlook first.
 *
 * recipient: { name, email } — the contact being outreached
 */
export async function createOutlookDraft(
  userId: string,
  subject: string,
  body: string,
  recipient: { name: string; email: string },
): Promise<GraphDraftResult> {
  let accessToken: string;
  try {
    accessToken = await getAccessToken(userId);
  } catch (e) {
    return { messageId: null, webLink: null, error: (e as Error).message };
  }

  const payload = {
    subject,
    body: {
      contentType: "Text",
      content: body,
    },
    toRecipients: [
      {
        emailAddress: {
          address: recipient.email,
          name: recipient.name,
        },
      },
    ],
  };

  const res = await fetch(`${GRAPH_BASE}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Graph createMessage failed:", res.status, body);
    return {
      messageId: null,
      webLink: null,
      error: `Graph API error ${res.status}: ${res.statusText}`,
    };
  }

  const msg = await res.json();
  return {
    messageId: msg.id ?? null,
    webLink: msg.webLink ?? null,
    error: null,
  };
}

export type GraphMessage = {
  id: string;
  subject: string | null;
  bodyText: string | null;
  from: string | null;
  receivedAt: string;
};

/**
 * Fetch messages in the user's inbox/sent folder from a specific sender
 * address within the last `lookbackDays` days. Returns plain-text body.
 * Requests text body via Prefer header to avoid HTML parsing.
 */
export async function fetchMessagesFromSender(
  userId: string,
  senderEmail: string,
  lookbackDays = 90,
  db?: SupabaseClient,
): Promise<{ messages: GraphMessage[]; error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getAccessToken(userId, db);
  } catch (e) {
    return { messages: [], error: (e as Error).message };
  }

  const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString();
  // NB: receivedDateTime must come FIRST in the filter, and $orderby must be
  // omitted — combining a from/emailAddress filter with $orderby makes Graph
  // reject the query with 400 InefficientFilter. We sort client-side instead.
  const filter = `receivedDateTime ge ${since} and from/emailAddress/address eq '${senderEmail}'`;
  const select = "id,subject,body,receivedDateTime,from";
  const url = `${GRAPH_BASE}/me/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=50`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="text"',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Graph fetchMessages failed:", res.status, text);
    return { messages: [], error: `Graph API error ${res.status}` };
  }

  const json = await res.json();
  const messages: GraphMessage[] = (json.value ?? []).map(
    (m: Record<string, unknown>) => ({
      id: m.id as string,
      subject: (m.subject as string | null) ?? null,
      bodyText: ((m.body as Record<string, string> | null)?.content ?? null),
      from:
        (
          (m.from as Record<string, Record<string, string>> | null)
            ?.emailAddress?.address
        ) ?? null,
      receivedAt: m.receivedDateTime as string,
    }),
  );

  // Newest first (we dropped $orderby to keep Graph happy — see above).
  messages.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  return { messages, error: null };
}

export type GraphSentMessage = {
  id: string;
  subject: string | null;
  bodyText: string | null;
  sentAt: string;
};

/**
 * Fetch messages the user actually SENT to a specific recipient, from the
 * Sent Items folder. This is how the app learns that a pushed draft (or any
 * email written directly in Outlook) really went out.
 *
 * Uses $search (KQL "to:") because $filter can't target the toRecipients
 * collection; recipient and date are then re-checked client-side since
 * $search is fuzzy and can't combine with $filter.
 */
export async function fetchSentMessagesTo(
  userId: string,
  recipientEmail: string,
  lookbackDays = 90,
  db?: SupabaseClient,
): Promise<{ messages: GraphSentMessage[]; error: string | null }> {
  let accessToken: string;
  try {
    accessToken = await getAccessToken(userId, db);
  } catch (e) {
    return { messages: [], error: (e as Error).message };
  }

  const select = "id,subject,body,sentDateTime,toRecipients";
  const url =
    `${GRAPH_BASE}/me/mailFolders/sentitems/messages` +
    `?$search=${encodeURIComponent(`"to:${recipientEmail}"`)}` +
    `&$select=${select}&$top=50`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.body-content-type="text"',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Graph fetchSentMessages failed:", res.status, text);
    return { messages: [], error: `Graph API error ${res.status}` };
  }

  const since = Date.now() - lookbackDays * 86400_000;
  const wanted = recipientEmail.toLowerCase();

  const json = await res.json();
  const messages: GraphSentMessage[] = ((json.value ?? []) as Record<string, unknown>[])
    .filter((m) => {
      const sentAt = Date.parse((m.sentDateTime as string) ?? "");
      if (!Number.isFinite(sentAt) || sentAt < since) return false;
      const recipients = (m.toRecipients as Array<{ emailAddress?: { address?: string } }>) ?? [];
      return recipients.some(
        (r) => r.emailAddress?.address?.toLowerCase() === wanted,
      );
    })
    .map((m) => ({
      id: m.id as string,
      subject: (m.subject as string | null) ?? null,
      bodyText: ((m.body as Record<string, string> | null)?.content ?? null),
      sentAt: m.sentDateTime as string,
    }));

  messages.sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  return { messages, error: null };
}

/**
 * Disconnects Outlook by clearing the stored tokens. Does NOT revoke the
 * token server-side (would need an extra Graph call and the user can revoke
 * from their Microsoft account if they want).
 */
export async function disconnectOutlook(userId: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({
      outlook_email: null,
      outlook_access_token: null,
      outlook_refresh_token: null,
      outlook_token_expires_at: null,
    })
    .eq("id", userId);
}
