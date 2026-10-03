/**
 * Reads a South Dakota GFP survey PDF into lines of text on the phone (the
 * app's server only passes the file along: Cloudflare's free plan allows too
 * little compute per request to read PDFs there). unpdf is loaded only when a
 * report is opened, so it isn't part of the app's normal download.
 */

interface TextItem {
  str: string;
  transform: number[];
  width?: number;
}

const loadUnpdf = () => import('unpdf');

/** PDF text as lines per page: items on the same baseline joined left to right; wide gaps become " | " (table columns). */
export async function pdfLines(data: Uint8Array): Promise<string[][]> {
  const { getDocumentProxy } = await loadUnpdf();
  const pdf = await getDocumentProxy(data);
  const pages: string[][] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 12); p++) {
    const page = await pdf.getPage(p);
    const content = (await page.getTextContent()) as { items: TextItem[] };
    const rows = new Map<number, TextItem[]>();
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round((it.transform[5] ?? 0) / 2) * 2;
      rows.set(y, [...(rows.get(y) ?? []), it]);
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => {
        items.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
        let line = '';
        let end = -Infinity;
        for (const it of items) {
          const x = it.transform[4] ?? 0;
          if (line) line += x - end > 12 ? ' | ' : x - end > 1 ? ' ' : '';
          line += it.str.trim();
          end = x + (it.width ?? it.str.length * 5);
        }
        return line.replace(/\s+/g, ' ').trim();
      })
      .filter(Boolean);
    pages.push(lines);
  }
  return pages;
}

