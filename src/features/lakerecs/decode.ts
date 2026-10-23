/**
 * Posterior samples of θ (log-index) as packed in a tile. Encoding, exactly as
 * in types.ts (`SpeciesEstimate.q`):
 *   byte_i = clamp(round((θ_i − lo) / (hi − lo) × 255), 0, 255)
 *   d_0 = byte_0, d_i = byte_i − byte_{i−1}   (≥ 0 because sorted)
 *   q = standard base64 (with padding) of the d bytes
 *   decode: byte_i = Σ_{j≤i} d_j;  θ_i = lo + byte_i / 255 × (hi − lo)
 *
 * Rounding is "half up" (floor(x + 0.5)); the Python exporter must match it
 * (Python's round() rounds halves to even).
 */

export interface SampleScale {
  lo: number;
  hi: number;
}

function base64ToBytes(q: string): Uint8Array | null {
  try {
    const bin = atob(q.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decode `q` back to θ samples (ascending). Bad input gives an empty array, never an exception. */
export function decodeSamples(q: string, scale: SampleScale): Float64Array {
  const d = typeof q === 'string' && q ? base64ToBytes(q) : null;
  if (!d || !Number.isFinite(scale?.lo) || !Number.isFinite(scale?.hi)) return new Float64Array(0);
  const out = new Float64Array(d.length);
  const span = scale.hi - scale.lo;
  let acc = 0;
  for (let i = 0; i < d.length; i++) {
    // A damaged string could overflow the byte range; clamp instead of wrapping.
    acc = Math.min(255, acc + d[i]!);
    out[i] = scale.lo + (acc / 255) * span;
  }
  return out;
}

/** Quantize one θ to its byte on the scale (half up, clamped). */
export function quantize(theta: number, scale: SampleScale): number {
  const span = scale.hi - scale.lo;
  if (!(span > 0)) return 0;
  const x = ((theta - scale.lo) / span) * 255;
  return Math.max(0, Math.min(255, Math.floor(x + 0.5)));
}

/** Encode θ samples (sorted first) — the inverse of decodeSamples, for tests and fixtures. */
export function encodeSamples(samples: ArrayLike<number>, scale: SampleScale): string {
  const sorted = Array.from(samples).sort((a, b) => a - b);
  const bytes = sorted.map((t) => quantize(t, scale));
  const d = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) d[i] = i === 0 ? bytes[0]! : bytes[i]! - bytes[i - 1]!;
  return bytesToBase64(d);
}
