/**
 * Thin browser adapter: reads a File, parses it as XML with the real
 * `DOMParser`, and hands it to `@tmcw/togeojson`. This file is intentionally
 * not unit tested — there's no `DOMParser` in the Node test environment (no
 * jsdom here) — see `import.ts` for the pure conversion logic that IS
 * tested, against hand-built fixtures shaped like what `gpx()`/`kml()` below
 * actually produce.
 */
import { gpx, kml } from '@tmcw/togeojson';
import { featureCollectionToDrafts, type ImportOptions, type ImportResult, type MinimalFeatureCollection } from './import';

export type FileKind = 'gpx' | 'kml';

export function detectFileKind(filename: string): FileKind | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.gpx')) return 'gpx';
  if (lower.endsWith('.kml')) return 'kml';
  return null;
}

export function xmlTextToFeatureCollection(text: string, kind: FileKind): MinimalFeatureCollection {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) throw new Error('Could not parse this file as XML.');
  const fc = kind === 'gpx' ? gpx(doc) : kml(doc, { skipNullGeometry: true });
  return fc as unknown as MinimalFeatureCollection;
}

export interface FileImportOutcome extends ImportResult {
  fileName: string;
}

export async function importFile(file: File, opts: ImportOptions = {}): Promise<FileImportOutcome> {
  const kind = detectFileKind(file.name);
  if (!kind) {
    return { fileName: file.name, routes: [], pins: [], issues: [{ message: 'Not a .gpx or .kml file — skipped.' }] };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { fileName: file.name, routes: [], pins: [], issues: [{ message: 'Could not read this file.' }] };
  }
  let fc: MinimalFeatureCollection;
  try {
    fc = xmlTextToFeatureCollection(text, kind);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not parse this file.';
    return { fileName: file.name, routes: [], pins: [], issues: [{ message }] };
  }
  const result = featureCollectionToDrafts(fc, opts);
  return { fileName: file.name, ...result };
}

export async function importFiles(files: Iterable<File>, opts: ImportOptions = {}): Promise<FileImportOutcome[]> {
  const out: FileImportOutcome[] = [];
  for (const file of files) {
    out.push(await importFile(file, opts));
  }
  return out;
}
