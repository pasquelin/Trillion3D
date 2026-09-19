// Page side of the "composed presentation" proof: the engine presents its image with WebGPU on
// its own canvas, and a host whose surface is WebGL2 copies it with the engine's own program
// (`createCanvasBlit`) instead of a texture and a material of its rendering library. What is
// checked here is the copy itself: every channel of every pixel goes through unchanged, and the
// rows come out in the convention a readback publishes — the first row read is the last row of
// the presented image.
import { createCanvasBlit } from '../../packages/sdk-browser/webglCanvasBlit.ts';

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
  const target = document.createElement('canvas');
  target.width = WIDTH;
  target.height = HEIGHT;
  const gl = target.getContext('webgl2', {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return { indisponible: 'WEBGL2_UNAVAILABLE', erreurs: [], evenements: [] };
  const blit = createCanvasBlit(gl);
  try {
    gl.viewport(0, 0, WIDTH, HEIGHT);
    blit.draw(source.canvas);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const glError = gl.getError();
    let differents = 0,
      maxCanal = 0;
    for (let row = 0; row < HEIGHT; row++)
      for (let x = 0; x < WIDTH; x++) {
        const lu = (row * WIDTH + x) * 4,
          attendu = ((HEIGHT - 1 - row) * WIDTH + x) * 4;
        let ecart = 0;
        for (let canal = 0; canal < 3; canal++)
          ecart = Math.max(ecart, Math.abs(pixels[lu + canal] - source.data[attendu + canal]));
        if (ecart > 0) {
          differents++;
          maxCanal = Math.max(maxCanal, ecart);
        }
      }
    return {
      pixels: differents,
      maxCanal,
      total: WIDTH * HEIGHT,
      glError,
      erreurs: [],
      evenements: [],
    };
  } finally {
    blit.dispose();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
