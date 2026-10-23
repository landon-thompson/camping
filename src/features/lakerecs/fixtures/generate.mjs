// Synthetic lake-model fixtures for the engine tests (test data only — never
// copy into public/). Lakes are named "Fixture Lake …" with fake keys
// mn:99xxxxxx near Ely, MN, so drive/radius/tile logic gets exercised.
//
//   node src/features/lakerecs/fixtures/generate.mjs
//
// The encoder below is a deliberate second implementation of the format in
// types.ts; fixtures.test.ts checks it agrees with decode.ts.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const VERSION = '2026.10.0-fixture';

function normalQuantile(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const tail = (q) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function encode(samples, { lo, hi }) {
  const bytes = [...samples].sort((x, y) => x - y).map((t) => Math.max(0, Math.min(255, Math.floor(((t - lo) / (hi - lo)) * 255 + 0.5))));
  return Buffer.from(bytes.map((v, i) => (i === 0 ? v : v - bytes[i - 1]))).toString('base64');
}

const Z90 = 1.2815515655446004;
function estimate(scale, med, p10, p90, evidence, sizeIndex = null) {
  const sigma = (p90 - p10) / (2 * Z90);
  const samples = Array.from({ length: 200 }, (_, i) => med + sigma * normalQuantile((i + 0.5) / 200));
  return { med, p10, p90, q: encode(samples, scale), evidence, sizeIndex };
}

const lf = (dow) => `https://www.dnr.state.mn.us/lakefind/lake.html?id=${dow}`;
const src = (dow, date, gear, cpue) => ({ date, type: 'Standard Survey', gear, cpue, url: lf(dow) });
const launch = (name, lat, lng, ramp, rampClass) => ({ name, lat, lng, ramp, rampClass, source: 'fixture' });
const lake = (dow, name, lat, lng, extra) => ({
  key: `mn:${dow}`,
  name,
  state: 'MN',
  county: 'St. Louis',
  lat,
  lng,
  areaAcres: 500,
  maxDepthFt: 40,
  clarityFt: 10,
  sourceUrl: lf(dow),
  launches: [],
  regs: [],
  stocking: [],
  sp: {},
  ...extra,
});

const SCALE = { WAE: { lo: -1.5, hi: 3 }, NOP: { lo: -1.5, hi: 2 }, BLG: { lo: -1, hi: 2 } };
const S = SCALE;

const east = {
  format: 1,
  version: VERSION,
  id: 't_47.5_-92',
  scale: SCALE,
  lakes: [
    lake('99000001', 'Fixture Lake Alpha', 47.93, -91.8, {
      launches: [launch('Alpha Landing', 47.925, -91.805, 'Concrete', 'concrete')],
      stocking: [{ year: 2023, species: 'WAE', count: 100000, size: 'fry' }],
      sp: {
        WAE: estimate(S.WAE, 0.6, 0.35, 0.85, {
          surveys: 3,
          latestYear: 2024,
          ownWeight: 0.75,
          sources: [src('99000001', '2024-07-15', 'Standard gill nets', 9.1), src('99000001', '2019-07-20', 'Standard gill nets', 8.2), src('99000001', '2014-07-11', 'Standard gill nets', 7.4)],
        }, 1.1),
        NOP: estimate(S.NOP, 0.1, -0.3, 0.5, { surveys: 3, latestYear: 2024, ownWeight: 0.6, sources: [src('99000001', '2024-07-15', 'Standard gill nets', 4.2)] }),
      },
    }),
    lake('99000002', 'Fixture Lake Bravo', 47.8, -91.65, {
      launches: [launch('Bravo Access', 47.805, -91.66, 'Gravel', 'gravel')],
      sp: {
        WAE: estimate(S.WAE, 1.0, -0.1, 2.1, { surveys: 1, latestYear: 2011, ownWeight: 0.15, sources: [src('99000002', '2011-08-02', 'Standard gill nets', 14.5)] }),
      },
    }),
    lake('99000003', 'Fixture Lake Charlie', 47.95, -91.95, {
      launches: [launch('Charlie Portage', 47.948, -91.945, 'Carry-in', 'carry-in')],
      sp: {
        WAE: estimate(S.WAE, 1.2, 0.8, 1.6, { surveys: 2, latestYear: 2021, ownWeight: 0.6, sources: [src('99000003', '2021-07-01', 'Standard gill nets', 16)] }),
      },
    }),
    lake('99000004', 'Fixture Lake Delta', 47.75, -91.55, {
      launches: [launch('Delta Ramp', 47.752, -91.56, 'Concrete', 'concrete')],
      sp: {
        BLG: estimate(S.BLG, 0.4, 0.1, 0.7, { surveys: 2, latestYear: 2020, ownWeight: 0.5, sources: [src('99000004', '2020-06-20', 'Standard trap nets', 30)] }),
      },
    }),
    lake('99000005', 'Fixture Lake Echo', 47.55, -91.1, {
      launches: [launch('Echo Ramp', 47.552, -91.105, 'Concrete', 'concrete')],
      sp: {
        WAE: estimate(S.WAE, 0.8, 0.5, 1.1, { surveys: 2, latestYear: 2022, ownWeight: 0.6, sources: [src('99000005', '2022-07-01', 'Standard gill nets', 11)] }),
      },
    }),
    lake('99000006', 'Fixture Lake Foxtrot', 47.98, -91.7, {
      launches: [launch('Foxtrot Landing', 47.978, -91.705, '', 'unknown')],
      regs: [{ species: 'WAE', text: 'Fixture regulation text (synthetic, not a real rule).', url: lf('99000006'), fetchedAt: '2026-10-01' }],
      sp: {
        WAE: estimate(S.WAE, 0.3, 0.0, 0.6, {
          surveys: 2,
          latestYear: 2016,
          ownWeight: 0.45,
          sources: [src('99000006', '2016-06-10', 'Standard trap nets', 2.1), src('99000006', '2009-06-12', 'Standard trap nets', 1.8)],
        }),
      },
    }),
  ],
};

const west = {
  format: 1,
  version: VERSION,
  id: 't_47.5_-93',
  scale: SCALE,
  lakes: [
    lake('99000007', 'Fixture Lake Golf', 47.85, -92.15, {
      launches: [launch('Golf Canoe Access', 47.86, -92.1, 'Carry-in', 'carry-in'), launch('Golf Public Ramp', 47.85, -92.16, 'Concrete', 'concrete')],
      sp: {
        WAE: estimate(S.WAE, 0.5, 0.2, 0.8, {
          surveys: 2,
          latestYear: 2022,
          ownWeight: 0.65,
          sources: [src('99000007', '2022-07-08', 'Standard gill nets', 8.8), src('99000007', '2017-07-10', 'Standard gill nets', 7.9)],
        }),
      },
    }),
    lake('99000008', 'Fixture Lake Hotel', 47.75, -92.4, {
      launches: [launch('Hotel Ramp', 47.75, -92.4, 'Concrete', 'concrete')],
      sp: {
        WAE: estimate(S.WAE, 0.7, 0.4, 1.0, { surveys: 2, latestYear: 2023, ownWeight: 0.6, sources: [src('99000008', '2023-07-08', 'Standard gill nets', 10)] }),
      },
    }),
    lake('99000009', 'Fixture Lake India', 47.88, -92.05, {
      sp: {
        WAE: estimate(S.WAE, 0.9, 0.5, 1.3, { surveys: 1, latestYear: 2020, ownWeight: 0.4, sources: [src('99000009', '2020-07-08', 'Standard gill nets', 12)] }),
      },
    }),
  ],
};

mkdirSync(join(here, 'tiles'), { recursive: true });
const refs = [];
for (const tile of [east, west]) {
  const text = JSON.stringify(tile);
  writeFileSync(join(here, 'tiles', `${tile.id}.json`), text);
  const [, south, westLng] = tile.id.split('_').map(Number);
  refs.push({
    id: tile.id,
    bbox: [westLng, south, westLng + 1, south + 0.5],
    url: `tiles/${tile.id}.json`,
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
    lakes: tile.lakes.length,
  });
}
// Listed but deliberately not provided: the north neighbour, to exercise "missing tiles".
refs.push({ id: 't_48_-92', bbox: [-92, 48, -91, 48.5], url: 'tiles/t_48_-92.json', bytes: 1000, sha256: '0'.repeat(64), lakes: 0 });

const manifest = {
  format: 1,
  version: VERSION,
  createdAt: '2026-10-01T00:00:00Z',
  codeVersion: 'fixture',
  species: [
    { code: 'WAE', name: 'Walleye', primaryGear: 'Gill net', unit: 'fish per net', typicalCpue: { MN: 6, SD: null } },
    { code: 'NOP', name: 'Northern pike', primaryGear: 'Gill net', unit: 'fish per net', typicalCpue: { MN: 4, SD: null } },
    { code: 'BLG', name: 'Bluegill', primaryGear: 'Trap net', unit: 'fish per net', typicalCpue: { MN: 25, SD: null } },
  ],
  tiles: refs,
  validation: { n: 0, coverage80: 0, coverage50: 0, crpsModel: 0, crpsBaseline: 0, bySpecies: {} },
  sources: [{ name: 'Synthetic fixture', url: 'https://example.invalid/', terms: 'Test data only', fetchedAt: '2026-10-01' }],
  gaps: ['Fixture: synthetic numbers, not real lakes.'],
};
writeFileSync(join(here, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(refs.map((r) => `${r.id} ${r.bytes} B ${r.sha256.slice(0, 12)}`).join('\n'));
