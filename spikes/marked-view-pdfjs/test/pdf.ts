/** Build tiny text-only PDFs for tests: each line has a position and fill colour. */

export interface TextLine {
  text: string;
  x?: number;
  y: number; // PDF points from the bottom of an A4 page
  size?: number;
  rgb?: [number, number, number];
}

const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

export function textPdf(pages: TextLine[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) + 0; // object number
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages tree, filled in below
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const lines of pages) {
    const stream = lines
      .map(({ text, x = 60, y, size = 10, rgb = [0.2, 0.2, 0.2] }) =>
        `${rgb.join(" ")} rg BT /F1 ${size} Tf ${x} ${y} Td (${escape(text)}) Tj ET`)
      .join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
