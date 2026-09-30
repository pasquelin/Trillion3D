// #1369: the shipped `sampledSliceLighting`, run in JavaScript on a list of weights — each light's
// unshadowed contribution its weight times a factor, as `lightWeight` and `declaredLight` are, zero
// together. It walks the weights twice, shades at most `LIGHT_SAMPLES` lights, shades a light worth a
// sample's share exactly once whatever the offset, and averaged over the offsets its estimate is the
// full sum: the history converges to the still image's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { DIRECT_LIGHTING_WGSL } from './lightingWgsl.ts';

const SAMPLES = LIGHT_SETTINGS.samplesPerPixel,
  MAX = LIGHT_SETTINGS.tileLights;
const K = wgslConstants(DIRECT_LIGHTING_WGSL);
type Light = { index: number };
/** The list run, swapped per case: weights, contributions, the offset, and what was read. */
const live = { weights: [0], values: [0], offset: 0, walked: 0, shaded: [] as number[] };
const tileLights = new Uint32Array(MAX).map((_, i) => i);
const { sampledSliceLighting } = shaderRun<{
  sampledSliceLighting: (...args: unknown[]) => number[];
}>(DIRECT_LIGHTING_WGSL, ['sampledSliceLighting'], {
  ...K,
  tileLights,
  directLights: { items: [...Array(MAX).keys()].map((index) => ({ index })) },
  listedWeight: (_: number, index: number) => (live.walked++, live.weights[index]),
  lightWeight: (light: Light) => live.weights[light.index],
  declaredLight: (light: Light) => (
    live.shaded.push(light.index),
    [live.values[light.index], 0, 0]
  ),
  hashUnit: () => live.offset,
  fract: (x: number) => x - Math.floor(x),
});

/** The estimate of the list at `offset`, the weights walked and the lights shaded. */
function run(weights: number[], values: number[], offset: number) {
  Object.assign(live, { weights, values, offset, walked: 0, shaded: [] });
  // The list, from word 0 of the pool: light `i` at word `i`.
  const sum = sampledSliceLighting(0, 0, 0, 0, 0, 0, 0, [0, weights.length], 0, [0.5, 0.5])[0];
  return { sum, walked: live.walked, shaded: live.shaded };
}

/** A list and its contributions: each light's weight times a factor, a share of zeros. */
function list(r: () => number, kept: number, heavy: boolean) {
  const weights = [...Array(kept).keys()].map((i) =>
    r() < 0.2 ? 0 : heavy && i % 17 === 3 ? r() * 1e3 : r() ** 3,
  );
  return { weights, values: weights.map((w) => w * (0.5 + r() * 1.5)) };
}

test('two walks of the weights, at most LIGHT_SAMPLES lights shaded, the exact ones once', () => {
  const r = mulberry32(1369);
  for (let i = 0; i < 2000; i++) {
    const kept = SAMPLES + 1 + Math.floor(r() * (MAX - SAMPLES));
    const { weights } = list(r, kept, i % 3 === 0);
    const total = weights.reduce((a, b) => a + b, 0);
    const { walked, shaded } = run(weights, weights, r());
    assert.equal(walked, 2 * kept, 'two walks');
    assert.ok(shaded.length <= SAMPLES, `${shaded.length} lights shaded`);
    weights.forEach((w, index) => {
      const times = shaded.filter((s) => s === index).length;
      if (w * SAMPLES >= total) assert.equal(times, 1, `exact light ${index} shaded once`);
      if (w <= 0) assert.equal(times, 0, `light ${index} of no weight never shaded`);
    });
  }
});

test('averaged over the offsets, the drawn estimate is the full sum', () => {
  const r = mulberry32(924);
  const cases = [
    list(r, SAMPLES + 1, false),
    list(r, MAX, true),
    { weights: [1e3, ...Array<number>(SAMPLES).fill(1)], values: [2e3, 1, 2, 3, 4] },
    { weights: Array<number>(SAMPLES + 1).fill(1), values: [1, 2, 3, 4, 5] },
    { weights: Array<number>(MAX).fill(0.5), values: [...Array(MAX).keys()] },
    ...Array.from({ length: 20 }, (_, i) =>
      list(r, SAMPLES + 1 + Math.floor(r() * (MAX - SAMPLES)), i % 2 === 0),
    ),
  ];
  const STEPS = 8192;
  for (const { weights, values } of cases) {
    const full = values.reduce((a, b) => a + b, 0);
    let mean = 0;
    for (let k = 0; k < STEPS; k++) mean += run(weights, values, (k + 0.5) / STEPS).sum / STEPS;
    assert.ok(Math.abs(mean - full) <= 5e-3 * full, `${mean} against ${full}`);
  }
  // No weight, no light: nothing shaded.
  assert.equal(
    run(Array<number>(SAMPLES + 1).fill(0), Array<number>(SAMPLES + 1).fill(0), 0.3).sum,
    0,
  );
});
