import { mulberry32 } from '../../../site/examples/kit/random.ts';

export type Vec3 = readonly [number, number, number];

/**
 * `value` on a grid of 2⁻²⁰, about a micrometre. `Math.sin`, `Math.exp` and their kin may differ
 * in their last bit from one machine or runtime to the next, and a number that falls either side
 * of a rounding — to a float, a decimal, a byte — then changes the bytes a scene writes. Every
 * number a writer rounds is snapped first, to a grid far coarser than that noise and far finer
 * than anything the scene shows; what follows — products, sums, square roots — is exactly
 * rounded on every machine. Below 16 a single-precision float holds a grid value exactly.
 */
export const snap = (value: number) => Math.round(value * 2 ** 20) / 2 ** 20;

/**
 * A seeded random stream for the scenes modelled in code: the same seed gives the same uniform
 * draws on every machine, since they rest on integer arithmetic alone (a 32-bit mulberry
 * generator, the kit's `mulberry32`); what `normal` and `direction` derive through `Math` is snapped where it is written.
 */
export function randomStream(seed: number) {
  const next = mulberry32(seed);
  const uniform = (low = 0, high = 1) => low + (high - low) * next();
  // Box–Muller; `1 - next()` never reaches zero, so the logarithm stays finite.
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const direction = (): Vec3 => {
    const vector = [normal(), normal(), normal()],
      length = Math.hypot(...vector) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  };
  return {
    next,
    uniform,
    normal,
    direction,
    integer: (count: number) => Math.floor(next() * count),
  };
}

export type RandomStream = ReturnType<typeof randomStream>;

/**
 * Smooth relief from summed sines along random directions, `octaves` of them each finer and
 * fainter than the last: deterministic from `seed`, and cheap enough for every vertex.
 */
export function sineNoise(seed: number, octaves = 4) {
  const random = randomStream(seed),
    waves: { direction: Vec3; phase: number; amplitude: number; frequency: number }[] = [];
  for (let octave = 0, amplitude = 1, frequency = 1; octave < octaves; octave++) {
    for (let wave = 0; wave < 3; wave++)
      waves.push({
        direction: random.direction(),
        phase: random.uniform(0, 2 * Math.PI),
        amplitude,
        frequency,
      });
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return ([x, y, z]: Vec3) =>
    waves.reduce(
      (total, { direction: [dx, dy, dz], phase, amplitude, frequency }) =>
        total + (amplitude * Math.sin(frequency * (x * dx + y * dy + z * dz) * 3 + phase)) / 3,
      0,
    );
}
