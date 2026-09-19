// Page side of the "composed presentation" proof: the engine presents its image with WebGPU on
// its own canvas, and what carries that image away — a host whose surface is WebGL2, or the
// synchronous capture — copies it with the engine's own program (`createCanvasBlit`) instead of
// a texture and a material of a rendering library. What is checked here is the copy itself:
// every channel goes through unchanged, and the rows come out in the convention the SDK
// publishes — the first row read is the last row presented.
import { createSynchronousCanvasCapture } from '../../packages/sdk-browser/gpuPresentation.ts';
import { createCanvasBlit } from '../../packages/sdk-browser/webglCanvasBlit.ts';
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

/**
 * The same copy, into the kind of surface a host comparison draws to: a framebuffer the driver
 * encodes to sRGB on every write. Declared, the copy reads the source as sRGB and the hardware
 * decode cancels that encode; undeclared, the image comes back brightened once.
 */
function versCibleSrgb(source, attendu, equal) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return 'WEBGL2_UNAVAILABLE';
  const cible = gl.createTexture(),
    tampon = gl.createFramebuffer();
  const blit = createCanvasBlit(gl);
  try {
    gl.bindTexture(gl.TEXTURE_2D, cible);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, WIDTH, HEIGHT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tampon);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cible, 0);
    gl.viewport(0, 0, WIDTH, HEIGHT);
    blit.draw(source, true);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    equal(pixels, attendu, 'presented image copied to an sRGB render target');
  } finally {
    blit.dispose();
    gl.deleteFramebuffer(tampon);
    gl.deleteTexture(cible);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return null;
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
    const indisponible = versCibleSrgb(source.canvas, attendu, equal);
    if (indisponible) return { checks, indisponible, erreurs: [], evenements: [] };
  } catch (error) {
    return { checks, erreurs: [String(error)], evenements: [] };
  } finally {
    capture?.dispose();
  }
  return { checks, erreurs: [], evenements: [] };
}
