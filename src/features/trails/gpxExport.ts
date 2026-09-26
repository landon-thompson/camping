/**
 * Export selected routes + pins back to GPX, for re-import into onX Offroad
 * (the onX app only accepts GPX; the onX web map takes GPX or KML — see
 * docs/phase-4.md). `buildGpxDocument` is pure text-building so it's unit
 * tested directly; `downloadGpx` is the thin browser wrapper (Blob + `<a
 * download>`), not exercised in Node tests.
 */
import type { Pin, Route } from '../../model/trails';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wptXml(pin: Pin): string {
  const name = escapeXml(pin.name || 'Pin');
  const desc = pin.notes.trim() ? `\n    <desc>${escapeXml(pin.notes.trim())}</desc>` : '';
  return `  <wpt lat="${pin.position.lat}" lon="${pin.position.lng}">\n    <name>${name}</name>${desc}\n  </wpt>`;
}

function trkptXml(coord: readonly number[]): string {
  const lon = coord[0] ?? 0;
  const lat = coord[1] ?? 0;
  const ele = coord[2];
  const eleTag = typeof ele === 'number' && Number.isFinite(ele) ? `<ele>${ele}</ele>` : '';
  return `      <trkpt lat="${lat}" lon="${lon}">${eleTag}</trkpt>`;
}

function trkXml(route: Route): string {
  const parts: readonly (readonly number[])[][] =
    route.geometry.type === 'LineString' ? [route.geometry.coordinates] : route.geometry.coordinates;
  const segs = parts
    .map((part) => `    <trkseg>\n${part.map(trkptXml).join('\n')}\n    </trkseg>`)
    .join('\n');
  const name = escapeXml(route.name || 'Route');
  const desc = route.notes.trim() ? `\n    <desc>${escapeXml(route.notes.trim())}</desc>` : '';
  return `  <trk>\n    <name>${name}</name>${desc}\n${segs}\n  </trk>`;
}

/** Builds a GPX 1.1 document. Pure — no DOM, no Blob. */
export function buildGpxDocument(routes: readonly Route[], pins: readonly Pin[]): string {
  const body = [...pins.map(wptXml), ...routes.map(trkXml)].join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Camp Planner" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    (body ? body + '\n' : '') +
    '</gpx>\n'
  );
}

/** e.g. `camp-planner-2027-06-14.gpx` */
export function gpxFileName(prefix = 'camp-planner-export', date: Date = new Date()): string {
  return `${prefix}-${date.toISOString().slice(0, 10)}.gpx`;
}

/** Thin browser-only trigger: Blob + `<a download>`. Not exercised in Node tests. */
export function downloadGpx(xml: string, filename: string): void {
  const blob = new Blob([xml], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
