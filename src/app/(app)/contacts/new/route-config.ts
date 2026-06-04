// Route segment config for /contacts/new.
// Raises the function timeout to 60s so the Apify LinkedIn scrape
// (typically 10-30s) can complete before Vercel kills the request.
export const maxDuration = 60;
