// The deferred resolve's lists run on a real GPU (#849, #1369): the shipped `directLightingWgsl` —
// its narrow program (a scene of at most `TILE_LIGHTS` lights) and its wide one — shades the same
// samples through `contractLighting`, on a cell record of the light grid and its list in the pool
// (`cellRecord`). The f32 sums are compared as bits: the narrow list, the wide list, a list past
// `TILE_LIGHTS` and the walk over every light of the scene give the same sum, bit for bit, since a
// light that misses a point adds an exact zero.
//
//   node --experimental-strip-types --test tests/browser/probes/narrow-resolve-gpu.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts';
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import type { ResolveScene } from './narrowResolvePage.ts';
import { cellRecord, resolveRandom, resolveSamples, runResolves } from './resolveProbe.ts';

if (import.meta.main) {
  const LIST = LIGHT_SETTINGS.tileLights;
  const draw = resolveRandom(849);
  const { r, between, vector, unit } = draw;
  const { points, samples } = resolveSamples(128, draw);

  /** A sun, then point and spot lights, near the samples or far; none whose range sphere passes
   *  within 2% of a sample, so what reaches a sample is beyond doubt in f32. Returns the lights
   *  and the ranks of those that reach a sample: the tile's list. */
  function scene(count: number, near: number) {
    const sun: SceneLight = {
      id: 'sun',
      kind: 'directional',
      direction: unit([0.3, -1, 0.2]),
      color: [1, 0.95, 0.9],
      intensity: 2,
      castsShadow: false,
    };
    const lights = [sun],
      reach = [0];
    while (lights.length < count) {
      const close = r() < near;
      const position = vector(close ? 2.5 : 12) as [number, number, number];
      const range = close ? between(1.5, 4) : between(0.5, 3);
      const ratios = points.map((P) => Math.hypot(...P.map((x, i) => x - position[i])) / range);
      if (ratios.some((ratio) => Math.abs(ratio - 1) < 0.02)) continue;
      if (ratios.some((ratio) => ratio < 1)) reach.push(lights.length);
      const spot = r() < 0.4;
      lights.push({
        id: `l${lights.length}`,
        kind: spot ? 'spot' : 'point',
        position,
        ...(spot ? { direction: unit(vector(1)), coneAngle: 0.7, penumbra: 0.3 } : {}),
        color: [between(0.2, 1), between(0.2, 1), between(0.2, 1)],
        intensity: between(1, 20),
        range,
        castsShadow: false,
      });
    }
    return { lights, reach };
  }

  /** A cell's record in the narrow or wide program; with no `room`, every light of the scene. */
  const record = (narrow: boolean, list: number[], room = true) => ({
    narrow,
    words: cellRecord(list, [], room),
  });

  // Within the lists: 60 lights, the narrow resolve and the wide one on the same list.
  const small = scene(60, 0.5);
  // Past a list: 300 lights, more than `TILE_LIGHTS` reach the cell, its list or no room at all.
  const large = scene(300, 0.9);
  const missing = small.reach.filter((light) => light !== small.reach[1]);
  const SCENES: ResolveScene[] = [
    {
      lights: small.lights,
      samples,
      records: [
        record(true, small.reach),
        record(false, small.reach),
        record(false, small.reach, false),
        record(false, missing),
        // The same list through the program with no shadow code, the scene holding no shadow slot.
        { ...record(false, small.reach), unshadowed: true },
        // The same list through the program with no rectangle code: the scene holds none (#1369).
        { ...record(false, small.reach), rectless: true },
      ],
    },
    {
      lights: large.lights,
      samples,
      records: [record(false, large.reach), record(false, large.reach, false)],
    },
  ];

  test('the narrow resolve and the wide one give the same sums, bit for bit, on the GPU', async () => {
    assert.ok(small.reach.length > 8 && small.reach.length <= LIST, `${small.reach.length} reach`);
    assert.ok(large.reach.length > LIST, `${large.reach.length} reach the large tile`);
    const runs = await runResolves(SCENES, 'Narrow resolve', []);
    assert.deepEqual(
      runs.map((records) => records.length),
      SCENES.map((s) => s.records.length),
    );
    const [[narrow, wide, every, dropped, unshadowed, rectless], [pool, overflow]] = runs;
    assert.deepEqual(
      unshadowed,
      wide,
      'the program with no shadow code sums the same, bit for bit',
    );
    assert.deepEqual(
      rectless,
      wide,
      'the program with no rectangle code sums the same, bit for bit',
    );
    assert.deepEqual(narrow, wide, 'the narrow resolve sums what the wide one does, bit for bit');
    assert.deepEqual(wide, every, 'the list sums what every light does, bit for bit');
    assert.deepEqual(pool, overflow, 'a pool slice sums what every light does, bit for bit');
    // The sums are real: most samples are lit, and a list short of one reaching light is seen.
    const lit = (bits: number[]) =>
      points.filter((_, k) => bits.slice(4 * k, 4 * k + 3).some(Boolean));
    assert.ok(lit(narrow).length > 96 && lit(pool).length > 96, 'the samples are lit');
    assert.notDeepEqual(dropped, every, 'a missing light changes the sum');
  });
}
