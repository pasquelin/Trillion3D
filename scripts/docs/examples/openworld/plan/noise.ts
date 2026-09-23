/**
 * Seeded noise and small numeric helpers of the world plan (#332). Everything is a pure function
 * of its seed and coordinates: no `Math.random`, no clock, so one seed rebuilds the same bytes.
 */

const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Hermite step from 0 at `edge0` to 1 at `edge1`; the edges may be given in either order. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A 32-bit integer mix (murmur3 finaliser) of a lattice point and a seed, in [0, 1). */
export function hash2(seed: number, ix: number, iz: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A stable 32-bit sub-seed for a name: FNV-1a over its UTF-16 units, mixed with the seed. */
export function nameSeed(seed: number, name: string): number {
  let h = 0x811c9dc5 ^ seed;
  for (let index = 0; index < name.length; index++)
    h = Math.imul(h ^ name.charCodeAt(index), 0x01000193);
  return Math.floor(hash2(h, seed, name.length) * 4294967296) >>> 0;
}

/** Value noise in [-1, 1] on a unit lattice, with quintic fades so its slope is continuous. */
function valueNoise(seed: number, x: number, z: number): number {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz,
    u = fx * fx * fx * (fx * (fx * 6 - 15) + 10),
    v = fz * fz * fz * (fz * (fz * 6 - 15) + 10),
    a = hash2(seed, ix, iz),
    b = hash2(seed, ix + 1, iz),
    c = hash2(seed, ix, iz + 1),
    d = hash2(seed, ix + 1, iz + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Fractal sum of `octaves` value-noise layers, each twice as fine and half as strong: [-1, 1]. */
export function fbm(seed: number, x: number, z: number, octaves: number): number {
  let sum = 0,
    weight = 1,
    total = 0,
    scale = 1;
  for (let octave = 0; octave < octaves; octave++) {
    sum += weight * valueNoise(seed + octave * 101, x * scale, z * scale);
    total += weight;
    weight *= 0.5;
    scale *= 2.03;
  }
  return sum / total;
}

/** Ridged fractal in [0, 1]: sharp crests where the noise crosses zero, the shape of ranges. */
export function ridged(seed: number, x: number, z: number, octaves: number): number {
  let sum = 0,
    weight = 1,
    total = 0,
    scale = 1,
    previous = 1;
  for (let octave = 0; octave < octaves; octave++) {
    const crest = 1 - Math.abs(valueNoise(seed + octave * 131, x * scale, z * scale));
    sum += weight * crest * crest * previous;
    total += weight;
    previous = crest;
    weight *= 0.5;
    scale *= 2.03;
  }
  return sum / total;
}
