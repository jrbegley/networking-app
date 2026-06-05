import { createClient } from "@/lib/supabase/server";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

type TokenRow = {
  outlook_access_token: string | null;
  outlook_refresh_token: string | null;
  outlook_token_expires_at: string | null;
  outlook_email: string | null;
};

/**
 * Returns a valid access token for the signed-in user, refreshing if needed.
 * Throws if the user hasn't connected Outlook.
 */
async function getAccessToken(userId: string): Promise<string> {
  const supabase = await createClient();
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
        redirect_uri: `${SITE_URL}/auth/outlook/callback`,
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
