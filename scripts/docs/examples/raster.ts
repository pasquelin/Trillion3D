import { encodePng } from '../../../packages/sdk-node/src/cutout/png.mts';
import { snap, type RandomStream } from './random.ts';

/**
 * A small raster toolkit for the textures drawn in code: square float images of one or three
 * channels, in 0–255, drawn at twice their size, then brought down and softened. Every filter
 * wraps around the edges, so each image tiles without a seam.
 */
export interface Raster {
  size: number;
  channels: number;
  data: Float64Array;
}

export function raster(size: number, fill: readonly number[]): Raster {
  const data = new Float64Array(size * size * fill.length);
  for (let i = 0; i < data.length; i++) data[i] = fill[i % fill.length];
  return { size, channels: fill.length, data };
}

function paint(image: Raster, x: number, y: number, colour: readonly number[]) {
  if (x < 0 || y < 0 || x >= image.size || y >= image.size) return;
  for (let k = 0; k < image.channels; k++)
    image.data[(y * image.size + x) * image.channels + k] = colour[k];
}

/** Fills the pixels from `(x0, y0)` to `(x1, y1)` inclusive; what falls outside is dropped. */
export function fillRect(
  image: Raster,
  [x0, y0, x1, y1]: readonly number[],
  colour: readonly number[],
) {
  for (let y = Math.max(0, Math.ceil(y0)); y <= Math.min(image.size - 1, y1); y++)
    for (let x = Math.max(0, Math.ceil(x0)); x <= Math.min(image.size - 1, x1); x++)
      paint(image, x, y, colour);
}

/** Fills the pixels whose centre lies inside the polygon `points` (even–odd rule). */
export function fillPolygon(
  image: Raster,
  points: readonly (readonly [number, number])[],
  colour: readonly number[],
) {
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      const [px, py] = [x + 0.5, y + 0.5];
      let inside = false;
      points.forEach(([ax, ay], i) => {
        const [bx, by] = points[(i + 1) % points.length];
        if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
      });
      if (inside) paint(image, x, y, colour);
    }
}

/** The image a factor smaller, each pixel the mean of the block it covers. */
export function shrink(image: Raster, factor: number): Raster {
  const size = image.size / factor,
    out = raster(size, Array(image.channels).fill(0));
  for (let y = 0; y < image.size; y++)
    for (let x = 0; x < image.size; x++)
      for (let k = 0; k < image.channels; k++)
        out.data[(Math.floor(y / factor) * size + Math.floor(x / factor)) * image.channels + k] +=
          image.data[(y * image.size + x) * image.channels + k] / factor ** 2;
  return out;
}

/** A Gaussian blur of standard deviation `sigma` pixels, in two separable passes. */
export function blur(image: Raster, sigma: number): Raster {
  const radius = Math.ceil(sigma * 3),
    weights = Array.from({ length: radius * 2 + 1 }, (_, i) =>
      Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)),
    ),
    total = weights.reduce((sum, weight) => sum + weight, 0),
    { size, channels } = image;
  let source = image;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ]) {
    const out = raster(size, Array(channels).fill(0));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        weights.forEach((weight, i) => {
          const sx = (x + dx * (i - radius) + size) % size,
            sy = (y + dy * (i - radius) + size) % size;
          for (let k = 0; k < channels; k++)
            out.data[(y * size + x) * channels + k] +=
              (source.data[(sy * size + sx) * channels + k] * weight) / total;
        });
    source = out;
  }
  return source;
}

/** A tangent-space normal map, +Y up, from a one-channel height field in 0–1. */
export function normalMap(height: Raster, strength: number): Raster {
  const { size } = height,
    out = raster(size, [0, 0, 0]),
    at = (x: number, y: number) => height.data[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength,
        dy = (at(x, y + 1) - at(x, y - 1)) * strength,
        length = Math.hypot(dx, dy, 1);
      [-dx, dy, 1].forEach(
        (value, k) => (out.data[(y * size + x) * 3 + k] = (value / length) * 127.5 + 127.5),
      );
    }
  return out;
}

/**
 * Wrapping value noise in [0, 1]: `octaves` random lattices, the first `cells` a side and each
 * next one twice as fine and half as strong, smoothly interpolated and summed.
 */
export function valueNoise(size: number, cells: number, octaves: number, random: RandomStream) {
  const total = new Float64Array(size * size);
  for (let octave = 0, amplitude = 1; octave < octaves; octave++, amplitude /= 2) {
    const count = cells * 2 ** octave,
      lattice = Array.from({ length: count * count }, random.next),
      smooth = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const [u, v] = [(x / size) * count, (y / size) * count],
          [i, j] = [Math.floor(u), Math.floor(v)],
          [fu, fv] = [smooth(u - i), smooth(v - j)],
          value = (a: number, b: number) => lattice[((j + b) % count) * count + ((i + a) % count)],
          top = value(0, 0) + (value(1, 0) - value(0, 0)) * fu,
          bottom = value(0, 1) + (value(1, 1) - value(0, 1)) * fu;
        total[y * size + x] += amplitude * (top + (bottom - top) * fv);
      }
  }
  const peak = total.reduce((max, value) => Math.max(max, value), 0);
  return total.map((value) => value / peak);
}

/** The image as an opaque 8-bit PNG. */
export function png(image: Raster) {
  const rgba = new Uint8Array(image.size * image.size * 4);
  for (let p = 0; p < image.size * image.size; p++)
    for (let k = 0; k < 4; k++)
      rgba[p * 4 + k] =
        k === 3
          ? 255
          : Math.floor(
              Math.max(
                0,
                Math.min(
                  255,
                  snap(image.data[p * image.channels + (image.channels === 1 ? 0 : k)]),
                ),
              ),
            );
  return encodePng(image.size, image.size, rgba);
}
