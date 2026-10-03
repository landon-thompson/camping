import { describe, expect, it } from 'vitest';
import { parseSurvey } from './sdParse';
import { pdfLines } from './sdPdf';
import { makePdf } from './testPdf';

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
