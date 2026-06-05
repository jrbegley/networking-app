import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  if (!user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"));
  }

  const params = new URLSearchParams({
    client_id: process.env.AZURE_AD_CLIENT_ID!,
    response_type: "code",
    redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/outlook/callback`,
    response_mode: "query",
    scope: SCOPES,
    state: user.id,
  });

  const authorityUrl = `https://login.microsoftonline.com/${process.env.AZURE_AD_AUTHORITY ?? "common"}/oauth2/v2.0/authorize?${params}`;

  return NextResponse.redirect(authorityUrl);
}
