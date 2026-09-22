import { sessionOf } from '../core/worldSession.ts';

/** The size of a capture, in pixels. */
export type CaptureSize = { width: number; height: number };

/**
 * The view's pixels at `width × height`, top row first, drawn offscreen at that size
 * (`captureView`): the page's canvas keeps its size and what it shows.
 */
async function pixels(world: object, size: CaptureSize) {
  const session = sessionOf(world);
  const { width, height } = size;
  // The scene's latest writes reach the session with a frame of the view, as the world draws it.
  (world as { render?: () => void }).render?.();
  const bottomUp = await session.captureView(width, height);
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++)
    data.set(
      bottomUp.subarray((height - 1 - row) * width * 4, (height - row) * width * 4),
      row * width * 4,
    );
  return { width, height, data };
}

/** The `capture` family: an image of the view, taken aside. */
export const capture = {
  buffer: pixels,
  /** The image encoded as `type` (PNG by default). */
  async surface(world: object, p: CaptureSize & { type?: 'image/png' | 'image/jpeg' }) {
    const { width, height, data } = await pixels(world, p);
    const page = new OffscreenCanvas(width, height);
    page
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(data.buffer), width, height), 0, 0);
    return page.convertToBlob({ type: p.type ?? 'image/png' });
  },
};
