// Page side of the "composed presentation" proof: the engine presents its image with WebGPU on
// its own canvas, and what carries that image away — a host whose surface is WebGL2, or the
// synchronous capture — copies it with the engine's own program (`createCanvasBlit`) instead of
// a texture and a material of a rendering library. What is checked here is the copy itself:
// every channel goes through unchanged, and the rows come out in the convention the SDK
// publishes — the first row read is the last row presented.
import { createSynchronousCanvasCapture } from '../../packages/sdk-browser/gpuPresentation.ts';
import { createChecks } from './presentationChecks.mjs';

const WIDTH = 64,
  HEIGHT = 48;

/** A pattern no flip, transposition or offset can leave looking the same. */
function sourcePresentee() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.createImageData(WIDTH, HEIGHT);
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      image.data[i] = (x * 4) & 255;
      image.data[i + 1] = (y * 5) & 255;
      image.data[i + 2] = (x + y) & 255;
      image.data[i + 3] = 255;
    }
  context.putImageData(image, 0, 0);
  return { canvas, data: image.data };
}

export function executer() {
  const source = sourcePresentee();
  const checks = [];
  const { equal } = createChecks(checks);
  const attendu = new Uint8Array(source.data.length);
  for (let y = 0; y < HEIGHT; y++)
    attendu.set(
      source.data.subarray((HEIGHT - 1 - y) * WIDTH * 4, (HEIGHT - y) * WIDTH * 4),
      y * WIDTH * 4,
    );
  let capture;
  try {
    capture = createSynchronousCanvasCapture();
    equal(capture.read(source.canvas), attendu, 'presented image copied to a WebGL surface');
  } catch (error) {
    return { checks, erreurs: [String(error)], evenements: [] };
  } finally {
    capture?.dispose();
  }
  return { checks, erreurs: [], evenements: [] };
}
