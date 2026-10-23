import { describe, expect, it } from 'vitest';
import { decodeSamples, encodeSamples, quantize } from './decode';

describe('sample encoding', () => {
  // Hand-computed: lo = −1, hi = 1 (span 2).
  //   θ:     −1     −0.5            0.2          0.5             1
  //   x:      0     63.75           153          191.25          255
  //   byte:   0     64              153          191             255
  //   d:      0     64              89           38              64
  //   bytes 00 40 59 26 40 → base64 "AEBZJkA="
  const scale = { lo: -1, hi: 1 };
  const theta = [-1, -0.5, 0.2, 0.5, 1];

  it('matches the hand-computed vector', () => {
    expect(encodeSamples(theta, scale)).toBe('AEBZJkA=');
    const back = decodeSamples('AEBZJkA=', scale);
    expect(Array.from(back)).toEqual([-1, -1 + 128 / 255, -1 + 306 / 255, -1 + 382 / 255, 1]);
  });

  it('sorts before encoding', () => {
    expect(encodeSamples([1, 0.2, -1, 0.5, -0.5], scale)).toBe('AEBZJkA=');
  });

  it('round-trips within the quantization error', () => {
    const s = { lo: -1.5, hi: 3 };
    const samples = Array.from({ length: 200 }, (_, i) => -1.4 + (i / 199) * 4.3 + 0.001 * Math.sin(i));
    const back = decodeSamples(encodeSamples(samples, s), s);
    expect(back).toHaveLength(200);
    const sorted = [...samples].sort((a, b) => a - b);
    const tol = (s.hi - s.lo) / 255 / 2 + 1e-12;
    for (let i = 0; i < 200; i++) expect(Math.abs(back[i]! - Math.min(s.hi, sorted[i]!))).toBeLessThanOrEqual(tol);
  });

  it('clamps values outside the scale and rounds halves up', () => {
    expect(quantize(-5, scale)).toBe(0);
    expect(quantize(5, scale)).toBe(255);
    expect(quantize(0, scale)).toBe(128); // 127.5 → 128
  });

  it('never throws on bad input', () => {
    expect(decodeSamples('!!!not base64', scale)).toHaveLength(0);
    expect(decodeSamples('', scale)).toHaveLength(0);
    expect(decodeSamples('AEBZJkA=', { lo: Number.NaN, hi: 1 })).toHaveLength(0);
    // Overflowing deltas clamp at the top of the scale.
    const over = decodeSamples(btoa(String.fromCharCode(200, 100)), scale);
    expect(over[1]).toBe(1);
  });
});
