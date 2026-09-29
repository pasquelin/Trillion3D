import type { BloomTap } from './bloomFilter.ts';
import { bloomBlend, bloomLevelSizes } from './bloomFilter.ts';

/**
 * The published filters, rebuilt from their description rather than copied from the engine's
 * table (Jimenez, SIGGRAPH 2014): the downsample is five overlapping 2×2 boxes of bilinear taps —
 * the centre one, corners at ±1 texel, weighted 0.5, and the four whose corners reach ±2, weighted
 * 0.125 each —, the upsample a 3×3 tent, the outer product of (1, 2, 1) / 4 with itself.
 */
export function publishedDownTaps(): BloomTap[] {
  const weights = new Map<string, number>();
  const box = (cx: number, cy: number, weight: number) => {
    for (const [x, y] of [
      [cx - 1, cy - 1],
      [cx + 1, cy - 1],
      [cx - 1, cy + 1],
      [cx + 1, cy + 1],
    ])
      weights.set(`${x},${y}`, (weights.get(`${x},${y}`) ?? 0) + weight / 4);
  };
  box(0, 0, 0.5);
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    box(x, y, 0.125);
  return [...weights].map(([key, weight]) => {
    const [x, y] = key.split(',').map(Number);
    return [x, y, weight];
  });
}

export function publishedUpTaps(): BloomTap[] {
  const row = [1 / 4, 2 / 4, 1 / 4];
  return [-1, 0, 1].flatMap((y) =>
    [-1, 0, 1].map((x): BloomTap => [x, y, row[x + 1] * row[y + 1]]),
  );
}

/** Taps as a sorted list of `x,y:weight` words: two tables compare whatever their order. */
export const tapWords = (taps: readonly BloomTap[]) =>
  taps.map(([x, y, w]) => `${x},${y}:${w}`).sort();

export type Image = { data: Float64Array; w: number; h: number };

/** A bilinear read at texel coordinates `(x, y)`, clamped to the edge, as the samplers read. */
export function bilinear({ data, w, h }: Image, x: number, y: number) {
  const fx = x - 0.5,
    fy = y - 0.5;
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy),
    tx = fx - x0,
    ty = fy - y0;
  const at = (i: number, j: number) =>
    data[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
  return (
    (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
    (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
  );
}

/** One filter pass: every texel of an `ow` × `oh` image reads `from` at its centre plus each
 *  tap, in texels of `from` scaled by `stride`. */
function filter(from: Image, ow: number, oh: number, taps: readonly BloomTap[], stride: number) {
  const data = new Float64Array(ow * oh);
  for (let j = 0; j < oh; j++)
    for (let i = 0; i < ow; i++) {
      const x = ((i + 0.5) * from.w) / ow,
        y = ((j + 0.5) * from.h) / oh;
      let c = 0;
      for (const [dx, dy, weight] of taps)
        c += bilinear(from, x + dx * stride, y + dy * stride) * weight;
      data[j * ow + i] = c;
    }
  return { data, w: ow, h: oh };
}

/**
 * The CPU oracle of the whole bloom, on one channel, with the given taps: down the levels, back up
 * adding each level into the one above, then the blend (`bloomBlend`) — the order the WGSL and
 * GLSL programs draw in.
 */
export function cpuBloom(
  image: Image,
  intensity: number,
  radius: number,
  down: readonly BloomTap[],
  up: readonly BloomTap[],
) {
  const sizes = bloomLevelSizes(image.w, image.h);
  const levels: Image[] = [];
  for (const [w, h] of sizes) levels.push(filter(levels.at(-1) ?? image, w, h, down, 1));
  for (let level = levels.length - 2; level >= 0; level--) {
    const target = levels[level];
    const added = filter(levels[level + 1], target.w, target.h, up, radius);
    for (let i = 0; i < target.data.length; i++) target.data[i] += added.data[i];
  }
  const { keep, glow } = bloomBlend(intensity, levels.length);
  const blurred = filter(levels[0], image.w, image.h, up, radius);
  const data = image.data.map((value, i) => value * keep + blurred.data[i] * glow);
  return { data, w: image.w, h: image.h };
}

/** Every `c+=<read>(uv+vec2(x,y)*stride)*w;` of a text, as taps. */
export function tapsOf(text: string): BloomTap[] {
  const taps: BloomTap[] = [];
  const pattern = /c\+=\w+\((?:level,)?uv\+vec2f?\(([-\d.]+),([-\d.]+)\)\*stride\)\*([\d.e-]+);/g;
  for (const [, x, y, w] of text.matchAll(pattern)) taps.push([Number(x), Number(y), Number(w)]);
  return taps;
}

/** An `rgba16float` target's store of `x`: the nearest half, ties to even, ±Inf from 65520 on,
 *  NaN and the zeros' sign kept (`Math.f16round`, missing from Node 22). */
export function f16(x: number) {
  const a = Math.abs(x);
  if (!Number.isFinite(x)) return x;
  if (a >= 65520) return Math.sign(x) * Infinity;
  let e = Math.max(-14, Math.floor(Math.log2(a || 1)));
  if (2 ** e > a && e > -14) e--;
  const step = 2 ** (e - 10),
    n = a / step,
    floor = Math.floor(n);
  const up = n - floor > 0.5 || (n - floor === 0.5 && floor % 2 === 1);
  return (x < 0 || Object.is(x, -0) ? -1 : 1) * (up ? floor + 1 : floor) * step;
}
