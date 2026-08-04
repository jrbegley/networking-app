import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type {
  Document as XDocument,
  Element as XElement,
  Node as XNode,
} from "@xmldom/xmldom";
import type { LetterClassification, CoverLetterContent } from "./cover-letter-types";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function readDocumentXml(docx: Uint8Array): { zip: PizZip; doc: XDocument; body: XElement } {
  const zip = new PizZip(docx);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("Not a .docx: word/document.xml missing.");
  const doc = new DOMParser().parseFromString(file.asText(), "text/xml") as unknown as XDocument;
  const body = doc.getElementsByTagName("w:body")[0] as unknown as XElement;
  if (!body) throw new Error("Not a Word document: no w:body.");
  return { zip, doc, body };
}

/** Top-level w:p children of w:body, in order. Skips table/textbox paragraphs. */
function topLevelParagraphs(body: XElement): XElement[] {
  const out: XElement[] = [];
  for (let n: XNode | null = body.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as XElement).nodeName === "w:p") out.push(n as XElement);
  }
  return out;
}

function paragraphText(p: XElement): string {
  const ts = p.getElementsByTagName("w:t");
  let s = "";
  for (let i = 0; i < ts.length; i++) s += ts.item(i)?.textContent ?? "";
  return s;
}

export function extractParagraphs(docx: Uint8Array): { index: number; text: string }[] {
  const { body } = readDocumentXml(docx);
  return topLevelParagraphs(body).map((p, index) => ({ index, text: paragraphText(p) }));
}

export function templateExampleText(docx: Uint8Array): string {
  return extractParagraphs(docx).map((p) => p.text).join("\n");
}

/** Put `text` into the first w:t of the paragraph, blank the rest. Preserves the first run's rPr. */
function setParagraphText(p: XElement): (text: string) => void {
  return (text: string) => {
    const ts = p.getElementsByTagName("w:t");
    if (ts.length === 0) return;
    const first = ts.item(0)!;
    first.setAttribute("xml:space", "preserve");
    first.textContent = text;
    for (let i = 1; i < ts.length; i++) ts.item(i)!.textContent = "";
  };
}

export function applyContent(
  docx: Uint8Array,
  cls: LetterClassification,
  content: CoverLetterContent,
): Uint8Array {
  const { zip, doc, body } = readDocumentXml(docx);
  const paras = topLevelParagraphs(body);

  // Single-line fields: replace text in place, preserving formatting.
  const dateIdx = cls.roles.indexOf("date");
  if (dateIdx >= 0 && content.date) setParagraphText(paras[dateIdx])(content.date);

  const salIdx = cls.roles.indexOf("salutation");
  if (salIdx >= 0 && content.salutation) setParagraphText(paras[salIdx])(content.salutation);

  // Recipient: map lines onto consecutive recipient paragraphs; clone the last for overflow.
  const recipIdxs = cls.roles.flatMap((r, i) => (r === "recipient" ? [i] : []));
  if (recipIdxs.length && content.recipient.length) {
    const lastRecip = paras[recipIdxs[recipIdxs.length - 1]];
    for (let i = 0; i < content.recipient.length; i++) {
      if (i < recipIdxs.length) {
        setParagraphText(paras[recipIdxs[i]])(content.recipient[i]);
      } else {
        const clone = lastRecip.cloneNode(true) as XElement;
        setParagraphText(clone)(content.recipient[i]);
        lastRecip.parentNode!.insertBefore(clone, lastRecip.nextSibling);
      }
    }
    // Blank any leftover template recipient paragraphs.
    for (let i = content.recipient.length; i < recipIdxs.length; i++) {
      setParagraphText(paras[recipIdxs[i]])("");
    }
  }

  // Body: replace the contiguous range with N new paragraphs cloning a template body paragraph.
  if (cls.bodyStart >= 0 && cls.bodyEnd >= cls.bodyStart) {
    const templateBody = paras[cls.bodyStart].cloneNode(true) as XElement;
    const anchor = paras[cls.bodyEnd].nextSibling; // insert before whatever followed the body
    const parent = paras[cls.bodyStart].parentNode!;
    for (let i = cls.bodyStart; i <= cls.bodyEnd; i++) parent.removeChild(paras[i]);
    for (const text of content.body) {
      const clone = templateBody.cloneNode(true) as XElement;
      setParagraphText(clone)(text);
      parent.insertBefore(clone, anchor);
    }
  }

  const xml = new XMLSerializer().serializeToString(doc as unknown as XNode);
  zip.file("word/document.xml", xml);
  return zip.generate({ type: "uint8array" });
}
