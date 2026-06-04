/**
 * Client-side PDF text extraction.
 *
 * Runs entirely in the browser — the PDF never reaches our server.
 * pdfjs-dist is heavy (~1MB), so we dynamic-import it to keep it out of
 * the main client bundle. Cost is paid only by users who upload a PDF.
 *
 * Returns the concatenated text content of all pages, with page breaks
 * inserted between pages so structure isn't completely lost.
 */
export async function parsePdfToText(file: File): Promise<string> {
  if (file.type && file.type !== "application/pdf") {
    throw new Error("File must be a PDF.");
  }

  // Dynamic import — only loads when the user actually clicks Upload PDF.
  const pdfjs = await import("pdfjs-dist");

  // Worker is served from cdnjs (matches the installed version exactly via
  // pdfjs.version). This avoids bundler-specific worker-loading magic and
  // works in dev, Turbopack, webpack, and production Vercel builds alike.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const text = textContent.items
      // TextContent items can be TextItem (has .str) or TextMarkedContent (no .str)
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    pageTexts.push(text);
  }

  return pageTexts.join("\n\n").trim();
}
