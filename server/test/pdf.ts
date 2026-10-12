/** Kleinste PDF-Dateien für Tests: eine Textzeile pro Eintrag, optional mit Gliederung und Seitenzahlen. */
export interface PdfOptions {
  /** Gliederung, page 1-basiert; level 1 hängt am vorherigen Eintrag mit level 0 */
  outline?: { title: string; page: number; level?: 0 | 1 }[];
  /** gedruckte Seitenzahl der ersten Seite (PageLabels) */
  firstLabel?: number;
}

const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);

export function makePdf(pages: string[][], opts: PdfOptions = {}): Uint8Array {
  const objects: string[] = [];
  /** liefert die Objektnummer (1-basiert) */
  const add = (body: string) => objects.push(body);
  const ref = (n: number) => `${n} 0 R`;

  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageRefs = pages.map((lines) => {
    const ops = lines.map((line, i) => `${i === 0 ? '' : 'T* '}(${escape(line)}) Tj`).join('\n');
    const stream = `BT /F1 12 Tf 14 TL 50 750 Td\n${ops}\nET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${ref(pagesObj)} /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${ref(font)} >> >> /Contents ${ref(content)} >>`);
  });
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageRefs.map(ref).join(' ')}] /Count ${pages.length} >>`;

  let extra = '';
  if (opts.outline?.length) {
    const root = add('');
    // Baum aufbauen: Einträge mit level 1 werden Kinder des letzten level-0-Eintrags
    type Node = { id: number; title: string; page: number; children: Node[] };
    const top: Node[] = [];
    for (const entry of opts.outline) {
      const node: Node = { id: add(''), title: entry.title, page: entry.page, children: [] };
      if (entry.level === 1 && top.length) top[top.length - 1].children.push(node);
      else top.push(node);
    }
    const link = (nodes: Node[], parent: number) =>
      nodes.forEach((node, i) => {
        const kids = node.children.length
          ? ` /First ${ref(node.children[0].id)} /Last ${ref(node.children.at(-1)!.id)} /Count ${node.children.length}`
          : '';
        const prev = i > 0 ? ` /Prev ${ref(nodes[i - 1].id)}` : '';
        const next = i < nodes.length - 1 ? ` /Next ${ref(nodes[i + 1].id)}` : '';
        objects[node.id - 1] =
          `<< /Title (${escape(node.title)}) /Parent ${ref(parent)} /Dest [${ref(pageRefs[node.page - 1])} /Fit]${prev}${next}${kids} >>`;
        link(node.children, node.id);
      });
    link(top, root);
    objects[root - 1] = `<< /Type /Outlines /First ${ref(top[0].id)} /Last ${ref(top.at(-1)!.id)} /Count ${top.length} >>`;
    extra += ` /Outlines ${ref(root)}`;
  }
  if (opts.firstLabel !== undefined) extra += ` /PageLabels << /Nums [0 << /S /D /St ${opts.firstLabel} >>] >>`;
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${ref(pagesObj)}${extra} >>`;

  // Latin-1: ein Byte pro Zeichen, damit die Offsets in der xref-Tabelle stimmen
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${ref(catalog)} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
