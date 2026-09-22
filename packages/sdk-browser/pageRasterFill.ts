import type { HostAttribute } from './hostResources.ts';
import { barycentricAt, signedArea } from './visibilityProjection.ts';

/**
 * The oracle's projection and fill rule: one triangle at a time, from three vertex ranks to the
 * pixels they cover. No depth and no order — the caller submits in the order the engine does, and
 * the last triangle over a pixel keeps it, exactly as the reference raster resolves it.
 */

/** Where an oracle draws: the image and its dimensions, held together rather than passed apart. */
export type RasterTarget = { pixels: Uint8Array; width: number; height: number };

const local = new Float64Array(3),
  clip = new Float64Array(3);
const pa = { x: 0, y: 0 },
  pb = { x: 0, y: 0 },
  pc = { x: 0, y: 0 };

/**
 * `out = M · (x, y, z, 1)`, divided through. The reciprocal is taken once and multiplied in,
 * term for term as the reference library does it: a division per component would round
 * elsewhere, and an oracle compared pixel for pixel reads that rounding on a silhouette.
 */
function apply(out: Float64Array, m: ArrayLike<number>, x: number, y: number, z: number) {
  const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * w;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * w;
}

/** One vertex, from its place to its pixel: the world pose, then the clip matrix, then the
 *  viewport, y downward. */
function project(
  world: ArrayLike<number>,
  position: HostAttribute,
  vi: number,
  viewProj: Float64Array,
  target: RasterTarget,
  out: { x: number; y: number },
) {
  apply(local, world, position.getX(vi), position.getY(vi), position.getZ(vi));
  apply(clip, viewProj, local[0], local[1], local[2]);
  out.x = (clip[0] * 0.5 + 0.5) * target.width;
  out.y = (1 - (clip[1] * 0.5 + 0.5)) * target.height;
}

/** Projects the three corners a triangle names and fills what they cover with `rgb`. The ranks
 *  are passed apart rather than as a triple: a triple would allocate per triangle. */
export function rasterTriangle(
  target: RasterTarget,
  world: ArrayLike<number>,
  position: HostAttribute,
  viewProj: Float64Array,
  first: number,
  second: number,
  third: number,
  rgb: number[],
) {
  project(world, position, first, viewProj, target, pa);
  project(world, position, second, viewProj, target, pb);
  project(world, position, third, viewProj, target, pc);
  fillTriangle(target, pa, pb, pc, rgb);
}

function fillTriangle(
  { pixels, width, height }: RasterTarget,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  rgb: number[],
) {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))),
    maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))),
    maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const area = signedArea(a, b, c);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const { w0, w1, w2 } = barycentricAt(a, b, c, x, y, area);
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const o = (y * width + x) * 4;
      pixels[o] = rgb[0];
      pixels[o + 1] = rgb[1];
      pixels[o + 2] = rgb[2];
      pixels[o + 3] = 255;
    }
}
