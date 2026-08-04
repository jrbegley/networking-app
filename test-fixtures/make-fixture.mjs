import PizZip from "pizzip";
import { writeFileSync } from "node:fs";

const p = (text) =>
  `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${p("Jane Applicant")}
${p("2026-01-01")}
${p("Hiring Manager")}
${p("Acme Corp")}
${p("Dear Hiring Manager,")}
${p("This is the first body paragraph of the example letter.")}
${p("This is the second body paragraph of the example letter.")}
${p("Sincerely,")}
${p("Jane Applicant")}
<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body>
</w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`;

const header1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>LETTERHEAD</w:t></w:r></w:p></w:hdr>`;

const zip = new PizZip();
zip.file("[Content_Types].xml", contentTypes);
zip.file("_rels/.rels", rootRels);
zip.file("word/document.xml", documentXml);
zip.file("word/_rels/document.xml.rels", docRels);
zip.file("word/header1.xml", header1);

const buf = zip.generate({ type: "nodebuffer" });
writeFileSync(new URL("./template.docx", import.meta.url), buf);
console.log("wrote template.docx", buf.length, "bytes");
