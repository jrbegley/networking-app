import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // user.id we passed as state
  const error = searchParams.get("error");

  if (error || !code) {
    const desc = searchParams.get("error_description") ?? error ?? "Unknown error";
    return NextResponse.redirect(
      `${SITE_URL}/settings?outlook_error=${encodeURIComponent(desc)}`,
    );
  }

  // Exchange code for tokens
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_AD_AUTHORITY ?? "common"}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${SITE_URL}/auth/outlook/callback`,
      }),
    },
  );

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("Outlook token exchange failed:", body);
    return NextResponse.redirect(
      `${SITE_URL}/settings?outlook_error=${encodeURIComponent("Token exchange failed")}`,
    );
  }

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Fetch the user's Outlook email address
  const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const me = meRes.ok ? await meRes.json() : null;
  const outlookEmail: string | null = me?.mail ?? me?.userPrincipalName ?? null;

  const supabase = await createClient();

  // Verify state matches signed-in user (CSRF protection)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== state) {
    return NextResponse.redirect(`${SITE_URL}/login`);
  }

  await supabase
    .from("profiles")
    .update({
      outlook_email: outlookEmail,
      outlook_access_token: tokens.access_token,
      outlook_refresh_token: tokens.refresh_token ?? null,
      outlook_token_expires_at: expiresAt,
    })
    .eq("id", user.id);

  return NextResponse.redirect(`${SITE_URL}/settings?outlook_connected=1`);
}
