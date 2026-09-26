import { describe, expect, it } from 'vitest';
import { fitWithinMax } from './imageResize';

describe('fitWithinMax', () => {
  it('leaves an already-small image untouched', () => {
    expect(fitWithinMax(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('scales a landscape image down to the max on its longer side', () => {
    expect(fitWithinMax(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('scales a portrait image down to the max on its longer side', () => {
    expect(fitWithinMax(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never upscales', () => {
    expect(fitWithinMax(400, 300, 1600)).toEqual({ width: 400, height: 300 });
  });

  it('handles a square image exactly at the max', () => {
    expect(fitWithinMax(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it('returns zero size for invalid input instead of throwing', () => {
    expect(fitWithinMax(0, 100, 1600)).toEqual({ width: 0, height: 0 });
    expect(fitWithinMax(100, -1, 1600)).toEqual({ width: 0, height: 0 });
  });
});
