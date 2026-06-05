/**
 * Absolute origin for this deployment.
 *
 * Resolution order:
 *  1. NEXT_PUBLIC_SITE_URL (explicit override — set this in Vercel for prod)
 *  2. VERCEL_URL (injected automatically by Vercel for preview/prod deployments)
 *  3. localhost:3000 fallback for local dev
 *
 * VERCEL_URL has no scheme, so we prepend https://.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit && explicit.trim()) return explicit.trim().replace(/\/$/, "");

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl && vercelUrl.trim()) return `https://${vercelUrl.trim()}`;

  return "http://localhost:3000";
}
