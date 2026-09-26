import { describe, expect, it } from 'vitest';
import { buildGpxDocument, gpxFileName } from './gpxExport';
import type { Pin, Route } from '../../model/trails';

const route: Route = {
  tripId: 'trip:1',
  name: 'Forest Rd 170 & "Ridge" <spur>',
  source: 'onx',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-91.6, 47.9, 500],
      [-91.61, 47.905],
    ],
  },
  distanceMi: 1.2,
  estDriveMin: 5,
  flags: { noTrailer: true, fourWd: false, seasonalMud: true },
  difficulty: 3,
  notes: 'Muddy after rain & hard to turn around',
};

const multiRoute: Route = {
  ...route,
  name: 'Split trail',
  geometry: {
    type: 'MultiLineString',
    coordinates: [
      [
        [-92.0, 46.0],
        [-92.01, 46.01],
      ],
      [
        [-91.9, 46.2],
        [-91.91, 46.21],
      ],
    ],
  },
};

const pin: Pin = {
  tripId: 'trip:1',
  kind: 'dispersed',
  name: 'Site A & B',
  notes: 'Flat spot',
  position: { lat: 47.902, lng: -91.598 },
  photoIds: [],
};

describe('buildGpxDocument', () => {
  it('produces a valid-looking GPX 1.1 document with escaped names', () => {
    const xml = buildGpxDocument([route], [pin]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(xml).toContain('<wpt lat="47.902" lon="-91.598">');
    expect(xml).toContain('<name>Site A &amp; B</name>');
    expect(xml).toContain('<name>Forest Rd 170 &amp; &quot;Ridge&quot; &lt;spur&gt;</name>');
    expect(xml).toContain('<trkpt lat="47.9" lon="-91.6"><ele>500</ele></trkpt>');
    expect(xml).toContain('<trkpt lat="47.905" lon="-91.61"></trkpt>');
  });

  it('emits one <trkseg> per part of a MultiLineString', () => {
    const xml = buildGpxDocument([multiRoute], []);
    const segCount = (xml.match(/<trkseg>/g) ?? []).length;
    expect(segCount).toBe(2);
  });

  it('produces an (almost) empty but well-formed gpx for nothing selected', () => {
    const xml = buildGpxDocument([], []);
    expect(xml).toContain('<gpx');
    expect(xml).toContain('</gpx>');
    expect(xml).not.toContain('<wpt');
    expect(xml).not.toContain('<trk>');
  });
});

describe('gpxFileName', () => {
  it('includes the ISO date and .gpx extension', () => {
    const name = gpxFileName('camp-planner-export', new Date('2027-06-14T12:00:00Z'));
    expect(name).toBe('camp-planner-export-2027-06-14.gpx');
  });
});
