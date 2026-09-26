import type * as Engine from '../../../packages/sdk-browser/src/index.ts';
import { mix } from './opening.ts';

type Vec3 = [number, number, number];

/** A square picture of `size` pixels painted on a canvas, pixel by pixel: `pixel` gives the four
 *  bytes of each, red, green, blue and alpha. */
function painted(
  { texture }: Pick<typeof Engine, 'texture'>,
  size: number,
  pixel: (px: number, py: number) => readonly number[],
) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D,
    image = context.createImageData(size, size);
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++)
      pixel(px, py).forEach((value, channel) => (image.data[(py * size + px) * 4 + channel] = value));
  context.putImageData(image, 0, 0);
  return texture.canvas(canvas);
}

/** A leaf picture: green inside an almond outline with a darker midrib, see-through outside it. */
export function leafTexture(engine: Pick<typeof Engine, 'texture'>) {
  return painted(engine, 256, (px, py) => {
    const along = py / 256,
      across = Math.abs(px / 256 - 0.5);
    const width = 0.42 * Math.sin(Math.PI * along) ** 0.8,
      rib = across < 0.012 && along > 0.05 && along < 0.9;
    const alpha = Math.min(1, Math.max(0, (width - across) * 40 + 0.5));
    const rgba = [rib ? 0.3 : 0.36 - along * 0.1, rib ? 0.5 : 0.68, 0.16, alpha];
    return rgba.map((value) => Math.round(value * 255));
  });
}

/** How a matcap ball looks: its colour, the rim light at its edge, the strength and tightness of
 *  its highlight, how much of the room it reflects as a metal, and how far its light wraps round. */
export interface MatcapLook {
  base: Vec3;
  rim?: Vec3;
  shine?: number;
  gloss?: number;
  metal?: number;
  wrap?: number;
}

// The key light every ball is lit by, high on the left.
const KEY = (() => {
  const l = [-0.5, 0.65, 0.58],
    n = Math.hypot(...l);
  return l.map((value) => value / n);
})();

/**
 * A matcap: the picture of a lit ball, painted from its normal at each pixel — a diffuse part, a
 * highlight, a rim, and for metals a reflected room (a warm window high on the left, a dark floor,
 * a bright horizon).
 */
export function matcapBall(
  engine: Pick<typeof Engine, 'math' | 'texture'>,
  { base, rim = [0, 0, 0], shine = 0, gloss = 20, metal = 0, wrap = 0 }: MatcapLook,
) {
  const { clamp } = engine.math;
  const room = (r: number[]) => {
    const up = r[1],
      window = clamp((r[0] * KEY[0] + r[1] * KEY[1] + r[2] * KEY[2] - 0.8) * 6, 0, 1);
    const sky =
      up > 0
        ? mix([0.55, 0.52, 0.5], [0.2, 0.2, 0.24], clamp(up * 1.6, 0, 1))
        : mix([0.55, 0.5, 0.45], [0.05, 0.04, 0.04], clamp(-up * 3, 0, 1));
    return mix(sky, [1.4, 1.25, 1.05], window);
  };
  return painted(engine, 256, (px, py) => {
    // The normal of the ball at this pixel; outside it, the edge's normal, so a sample at the
    // silhouette never reads the background.
    let x = ((px + 0.5) / 256) * 2 - 1,
      y = 1 - ((py + 0.5) / 256) * 2;
    const reach = Math.hypot(x, y);
    if (reach > 0.999) [x, y] = [(x / reach) * 0.999, (y / reach) * 0.999];
    const n = [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
    const lit = clamp((n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2] + wrap) / (1 + wrap), 0, 1);
    const half = [KEY[0], KEY[1], KEY[2] + 1],
      length = Math.hypot(...half);
    const spot = clamp((n[0] * half[0] + n[1] * half[1] + n[2] * half[2]) / length, 0, 1) ** gloss;
    const fresnel = (1 - n[2]) ** 3;
    const reflected = [2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] * n[2] - 1];
    const diffuse = base.map((value) => value * (0.18 + 0.9 * lit));
    const colour = mix(
      diffuse,
      room(reflected).map((value, k) => value * base[k] * 1.6),
      metal,
    ).map((value, k) => value + spot * shine + fresnel * rim[k]);
    return [...colour.map((value) => Math.round(clamp(value, 0, 1) ** (1 / 2.2) * 255)), 255];
  });
}
