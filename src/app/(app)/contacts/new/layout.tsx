// Segment config for /contacts/new. The page itself is a client component
// and client files can't export route segment config, so it lives here.
// 60s covers the Apify LinkedIn scrape (typically 10-30s) triggered by the
// page's server actions.
export const maxDuration = 60;

export default function NewContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
