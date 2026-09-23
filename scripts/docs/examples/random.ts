export type Vec3 = readonly [number, number, number];

/**
 * A seeded random stream for the scenes modelled in code: the same seed gives the same scene on
 * every machine, since it rests on integer arithmetic alone (a 32-bit mulberry generator) and
 * the few transcendental functions V8 computes identically everywhere.
 */
export function randomStream(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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
