/**
 * Pure sizing math is separated from the DOM-dependent resize so it can be
 * unit tested without a browser (createImageBitmap/canvas aren't available
 * under Node/vitest).
 */

/** Scales (width, height) down to fit within `max` on the longer side, preserving
 * aspect ratio. Never upscales a smaller image. */
export function fitWithinMax(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !(max > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Resize an image file to a JPEG blob capped at `max` px on its longest side (default 1600, ~0.8 quality). */
export async function resizeImageToJpeg(
  file: File | Blob,
  max = 1600,
  quality = 0.8,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithinMax(bitmap.width, bitmap.height, max);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is not available.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not encode the resized image.');
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}
