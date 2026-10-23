"""A tiny real PDF with text drawn at (x, y): port of src/features/fishing/testPdf.ts (tests and fixtures only)."""

from __future__ import annotations


def make_pdf(lines: list[tuple[float, float, str]] | list[list[tuple[float, float, str]]]) -> bytes:
    """One page per list of (x, y, text); a flat list makes a single page. Helvetica 10 pt, Letter size."""
    pages = lines if lines and isinstance(lines[0], list) else [lines]

    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    n = len(pages)
    font_obj = 3 + 2 * n
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", f"<< /Type /Pages /Kids [{' '.join(f'{3 + 2 * i} 0 R' for i in range(n))}] /Count {n} >>"]
    for i, page in enumerate(pages):
        stream = "\n".join(f"BT /F1 10 Tf {x} {y} Td ({esc(t)}) Tj ET" for x, y, t in page)
        data = stream.encode("latin-1")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_obj} 0 R >> >> /Contents {4 + 2 * i} 0 R >>")
        objs.append(f"<< /Length {len(data)} >>\nstream\n{stream}\nendstream")
    objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    out = b"%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs):
        offsets.append(len(out))
        out += f"{i + 1} 0 obj\n{o}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return out
