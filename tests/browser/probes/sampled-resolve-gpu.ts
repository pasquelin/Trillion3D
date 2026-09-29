// A moving image's resolve on a real GPU (#1249): the shipped `directLightingWgsl`, through
// `contractLighting` at a sampled rank, on random lamp sets of 1 to 256 and their edge cases — a
// lamp that reaches one sample only, a tile every lamp reaches. A list with no shadowed light sums
// what the still image (rank 0) sums, bit for bit; a list with one shadowed light sums what
// `sampledTileLighting` — the resolve every moving list ran before — sums, bit for bit.
//
//   node --experimental-strip-types --test tests/browser/probes/sampled-resolve-gpu.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS, type SceneLight } from '../../../packages/sdk-core/src/index.ts';
import {
  LIGHT_TILES_NARROW_SHADER,
  LIGHT_TILES_SHADER,
} from '../../../packages/sdk-browser/src/lighting/tiles/shader.ts';
import { compactTile, tileLayout } from '../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';
import type { ResolveScene } from './narrowResolvePage.ts';
import { resolveRandom, resolveSamples, runResolves } from './resolveProbe.ts';

const LIST = LIGHT_SETTINGS.tileLights;
const SAMPLES = LIGHT_SETTINGS.samplesPerPixel;
/** A moving image's rank: any but zero. */
const RANK = 37;
const draw = resolveRandom(1249);
const { r, between, vector, unit } = draw;
const { points, samples } = resolveSamples(64, draw);

type Lamp = { position: [number, number, number]; range: number };
const lamp = ({ position, range }: Lamp, index: number): SceneLight => {
  const spot = r() < 0.3;
  return {
    id: `l${index}`,
    kind: spot ? 'spot' : 'point',
    position,
    ...(spot ? { direction: unit(vector(1)), coneAngle: 0.8, penumbra: 0.3 } : {}),
    color: [between(0.2, 1), between(0.2, 1), between(0.2, 1)],
    intensity: between(1, 20),
    range,
    castsShadow: false,
  };
};
/** `count` lamps, a share `near` of them about the samples; `all` puts each over every sample. */
const lamps = (count: number, near: number, all = false): Lamp[] =>
  Array.from({ length: count }, () => {
    const close = all || r() < near;
    const position = vector(all ? 0.5 : close ? 2.5 : 10) as [number, number, number];
    return { position, range: all ? between(4, 6) : close ? between(1.5, 4) : between(0.5, 3) };
  });
/** A lamp whose sphere holds one sample alone: a hair past it, a hair wide. */
const oneSample = (): Lamp => {
  const [x, y, z] = points[5];
  return { position: [x + 0.004, y, z], range: 0.01 };
};

/** The tile's list: every lamp whose sphere comes within 30 % of a sample — those that reach
 *  one, and near misses that add an exact zero —, in rank order. */
const listOf = (set: Lamp[]) =>
  set.flatMap((l, i) =>
    points.some((P) => Math.hypot(...P.map((x, a) => x - l.position[a])) < l.range * 1.3)
      ? [i]
      : [],
  );

/** A record of `list` as the pass of a scene of `count` lamps writes it, its pool if it needs one. */
const record = (list: number[], count: number, drawn = false) => {
  const narrow = count <= LIST;
  const layout = tileLayout(narrow ? LIGHT_TILES_NARROW_SHADER : LIGHT_TILES_SHADER);
  const pool = { capacity: narrow ? 0 : list.length + 8, head: 0, overflow: 0 };
  return {
    narrow,
    drawn,
    words: [...compactTile(layout, { opaque: list, blend: [] }, count, undefined, pool)],
  };
};

const sets: Lamp[][] = [1, 2, 3, 4, 5, 6, 9, 17, 33, 48, 64, 65, 120, 200, 256].map((n) =>
  lamps(n, 0.7),
);
for (let k = 0; k < 6; k++) sets.push(lamps(1 + Math.floor(r() * 256), between(0.2, 0.9)));
sets.push([...lamps(20, 0.5), oneSample(), ...lamps(19, 0.5)]); // a lamp touching one sample
sets.push(lamps(LIST, 0, true), lamps(256, 0, true)); // a tile every lamp reaches
const lists = sets.map(listOf);

/** Per set: the moving and still resolves of the unshadowed lamps, the moving one of the drawn
 *  function beside it, then the moving and drawn resolves with one listed lamp shadowed. */
const SCENES: ResolveScene[] = sets.flatMap((set, s) => {
  const lights = set.map(lamp);
  const list = lists[s];
  const shadowed = list[Math.floor(list.length / 2)];
  return [
    {
      lights,
      samples,
      rank: RANK,
      records: [record(list, set.length), record(list, set.length, true)],
    },
    { lights, samples, rank: 0, records: [record(list, set.length)] },
    {
      lights: lights.map((light, i) => ({ ...light, castsShadow: i === shadowed })),
      samples,
      rank: RANK,
      slots: [[shadowed, 0]],
      records: [record(list, set.length), record(list, set.length, true)],
    },
  ];
});

test('a moving list sums as the still image unless it holds a shadow, then as it was drawn', async () => {
  assert.ok(
    lists.every((list) => list.length > 0),
    'every tile lists a lamp',
  );
  assert.deepEqual(lists.at(-2)!.length, LIST, 'every lamp reaches the tile');
  assert.ok(
    lists.some((l) => l.length > SAMPLES && l.length <= LIST),
    'lists that were drawn',
  );
  assert.ok(
    lists.some((l) => l.length > LIST),
    'a list past its record',
  );
  // The lamp over one sample reaches it and no other, and its tile lists it.
  const edge = sets.findIndex((set) => set.length === 40);
  const { position, range } = sets[edge][20];
  const reached = points.filter((P) => Math.hypot(...P.map((x, a) => x - position[a])) < range);
  assert.equal(reached.length, 1, 'one sample in reach');
  assert.ok(lists[edge].includes(20));
  const runs = await runResolves(SCENES, 'Sampled resolve');
  assert.equal(runs.length, SCENES.length);
  let differed = 0;
  sets.forEach((set, s) => {
    const [[moving, drawn], [still], [shadowMoving, shadowDrawn]] = runs.slice(3 * s, 3 * s + 3);
    const name = `${set.length} lamps, ${lists[s].length} listed`;
    assert.deepEqual(moving, still, `${name}: no shadow, the still sum, bit for bit`);
    assert.deepEqual(shadowMoving, shadowDrawn, `${name}: a shadow, the drawn sum, bit for bit`);
    assert.ok(still.some(Boolean), `${name}: the samples are lit`);
    differed += +(JSON.stringify(drawn) !== JSON.stringify(still));
  });
  // Drawing changed the sums of the lists it drew: the moving image's sum really changed.
  assert.ok(differed >= 5, `${differed} sets drawn differently from the still sum`);
});
