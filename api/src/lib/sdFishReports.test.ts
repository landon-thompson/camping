import { describe, expect, it } from 'vitest';
import { parseReportLinks, parseSurvey, pdfLines, pickSurvey, reportListUrl, waterNameVariants } from './sdFishReports';

/** A tiny real PDF with text drawn at (x, y) positions, like a report page. */
function makePdf(lines: [number, number, string][]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = lines.map(([x, y, t]) => `BT /F1 10 Tf ${x} ${y} Td (${esc(t)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe('SD GFP report list', () => {
  it('finds report links and picks the newest lake survey', () => {
    const html = `<table>
      <tr><td>Lake Survey</td><td>2020</td><td><a href="ExportPDF.ashx?ReportID=22891">Enemy Swim (2020)</a></td></tr>
      <tr><td>Creel Survey</td><td>2021</td><td><a href="ExportPDF.ashx?ReportID=23860">Creel and Lake Information</a></td></tr>
      <tr><td>Lake Survey</td><td>2021</td><td><a href='./ExportPDF.ashx?ReportID=28627&amp;x=1'>Enemy Swim (2021)</a></td></tr>
      <tr><td>Lake Map</td><td><a href="ExportPDF.ashx?ReportID=30000">Map</a></td></tr>
    </table>`;
    const links = parseReportLinks(html);
    expect(links.map((l) => l.id)).toEqual(['22891', '23860', '28627', '30000']);
    expect(pickSurvey(links)?.id).toBe('28627');
    expect(reportListUrl('Enemy Swim')).toBe('https://apps.sd.gov/GF56FisheriesReports/?Waterbody=Enemy+Swim');
    expect(waterNameVariants('Enemy Swim Lake')).toEqual(['Enemy Swim Lake', 'Enemy Swim']);
    expect(waterNameVariants('Lake Poinsett')).toEqual(['Lake Poinsett', 'Poinsett']);
  });
});

describe('SD GFP survey PDF', () => {
  it('reads lines and columns from a real PDF, then the summary and catch per net', async () => {
    const pdf = makePdf([
      [72, 740, 'Enemy Swim Lake Survey Summary'],
      [72, 720, '2021'],
      [72, 690, 'Yellow perch were numerous, accounting for 65% of the sample. Although walleye numbers'],
      [72, 676, 'were higher in 2021 than in 2020, relative abundance remained low (3.4 per gill net).'],
      [72, 662, 'Bluegill relative abundance was high (46.0/frame net) and fish ranged from 3.1 to 9.8 inches.'],
      [72, 630, 'Table 1. Mean CPUE of fish captured in gill nets and frame nets, Enemy Swim Lake, 2021.'],
      [72, 610, 'Gill nets'],
      [72, 596, 'Species'],
      [250, 596, 'CPUE'],
      [320, 596, 'PSD'],
      [72, 582, 'Walleye'],
      [250, 582, '3.4'],
      [320, 582, '52'],
      [72, 568, 'Yellow Perch'],
      [250, 568, '28.6'],
      [320, 568, '31'],
      [72, 548, 'Frame nets'],
      [72, 534, 'Bluegill'],
      [250, 534, '46.0'],
      [72, 520, 'Black Crappie'],
      [250, 520, '5.2'],
    ]);
    const pages = await pdfLines(pdf);
    expect(pages[0]).toContain('Walleye | 3.4 | 52');
    const s = parseSurvey(pages);
    expect(s.year).toBe(2021);
    expect(s.title).toBe('Enemy Swim Lake Survey Summary');
    expect(s.summary[0]).toMatch(/^Yellow perch were numerous/);
    expect(s.catches).toEqual([
      { species: 'Bluegill', gear: 'Frame nets', cpue: 46, from: 'table' },
      { species: 'Black Crappie', gear: 'Frame nets', cpue: 5.2, from: 'table' },
      { species: 'Yellow Perch', gear: 'Gill nets', cpue: 28.6, from: 'table' },
      { species: 'Walleye', gear: 'Gill nets', cpue: 3.4, from: 'table' },
    ]);
  });

  it('falls back to numbers quoted in the summary when there is no readable table', () => {
    const s = parseSurvey([
      ['Pickerel Survey Summary 2019', 'Walleye numbers were low (1.8/gill net) and northern pike were common (4.2 per gill net).', 'Bluegill were abundant (61.5/frame net) in the sample taken.'],
    ]);
    expect(s.catches.map((c) => [c.species, c.gear, c.cpue, c.from])).toEqual([
      ['Bluegill', 'Frame nets', 61.5, 'summary'],
      ['Northern Pike', 'Gill nets', 4.2, 'summary'],
      ['Walleye', 'Gill nets', 1.8, 'summary'],
    ]);
  });
});
