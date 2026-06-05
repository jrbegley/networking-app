import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";

const SCOPES = [
  "offline_access",
  "Mail.Send",
  "Mail.ReadWrite",
  "User.Read",
].join(" ");

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const siteUrl = getSiteUrl();

  if (!user) {
    return NextResponse.redirect(`${siteUrl}/login`);
  }

  const params = new URLSearchParams({
    client_id: process.env.AZURE_AD_CLIENT_ID!,
    response_type: "code",
    redirect_uri: `${siteUrl}/auth/outlook/callback`,
    response_mode: "query",
    scope: SCOPES,
    state: user.id,
  });

  const authorityUrl = `https://login.microsoftonline.com/${process.env.AZURE_AD_AUTHORITY ?? "common"}/oauth2/v2.0/authorize?${params}`;

  return NextResponse.redirect(authorityUrl);
}
