// A moving image's resolve on a real GPU (#1249): the shipped `directLightingWgsl`, through
// `contractLighting` at a sampled rank, on random lamp sets of 1 to 256 and their edge cases — a
// lamp that reaches one sample only, a cell every lamp reaches. A list with no shadowed light sums
// what the still image (rank 0) sums, bit for bit; a list with one shadowed light sums what
// `sampledSliceLighting` — the resolve every moving list ran before — sums, bit for bit.
//
//   node bench/dawn/proofs.ts tests/gpu/lighting/sampled-resolve.gpu.ts
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS, type SceneLight } from '../../../packages/sdk-core/src/index.ts';
import type { ResolveScene } from './resolvePage.ts';
import {
  assertSameBits,
  cellRecord,
  distance,
  resolveRandom,
  resolveSamples,
  runResolves,
} from './resolveCases.ts';

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
  set.flatMap((l, i) => (points.some((P) => distance(P, l.position) < l.range * 1.3) ? [i] : []));

/** A cell's record of `list`, named, as the grid pass of a scene of `count` lamps writes it:
 *  `shadowed` the listed ranks that carry a shadow slot, so the flag is the pass's. */
const record = (
  name: string,
  list: number[],
  count: number,
  drawn = false,
  shadowed: number[] = [],
) => ({
  name,
  narrow: count <= LIST,
  drawn,
  words: cellRecord(list, shadowed),
});

const sets: Lamp[][] = [1, 2, 3, 4, 5, 6, 9, 17, 33, 48, 64, 65, 120, 200, 256].map((n) =>
  lamps(n, 0.7),
);
for (let k = 0; k < 6; k++) sets.push(lamps(1 + Math.floor(r() * 256), between(0.2, 0.9)));
sets.push([...lamps(20, 0.5), oneSample(), ...lamps(19, 0.5)]); // a lamp touching one sample
sets.push(lamps(LIST, 0, true), lamps(256, 0, true)); // a tile every lamp reaches
const lists = sets.map(listOf);

/** Per set, three scenes: the moving resolve of the unshadowed lamps and the drawn function beside
 *  it; their still resolve; then, one listed lamp shadowed, the moving resolve, the drawn one and
 *  the moving program with no rectangle code. */
const SCENES: ResolveScene[] = sets.flatMap((set, s) => {
  const lights = set.map(lamp);
  const list = lists[s];
  const shadowed = list[Math.floor(list.length / 2)];
  return [
    {
      lights,
      samples,
      rank: RANK,
      records: [record('moving', list, set.length), record('drawn', list, set.length, true)],
    },
    { lights, samples, rank: 0, records: [record('still', list, set.length)] },
    {
      lights: lights.map((light, i) => ({ ...light, castsShadow: i === shadowed })),
      samples,
      rank: RANK,
      slots: [[shadowed, 0]],
      records: [
        record('shadowMoving', list, set.length, false, [shadowed]),
        record('shadowDrawn', list, set.length, true, [shadowed]),
        // The program with no rectangle code, moving too: the scene holds none (#1369).
        { ...record('rectless', list, set.length, false, [shadowed]), rectless: true },
      ],
    },
  ];
});

/** Per set, its name and every record's sums under the record's name. */
let readings: { name: string; sums: Record<string, number[]> }[] = [];
before(async () => {
  assert.ok(
    lists.every((list) => list.length > 0),
    'every tile lists a lamp',
  );
  assert.equal(lists.at(-2)!.length, LIST, 'every lamp reaches the tile');
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
  const reached = points.filter((P) => distance(P, position) < range);
  assert.equal(reached.length, 1, 'one sample in reach');
  assert.ok(lists[edge].includes(20));
  const runs = await runResolves(SCENES);
  assert.equal(runs.length, SCENES.length);
  readings = sets.map((set, s) => ({
    name: `${set.length} lamps, ${lists[s].length} listed`,
    sums: Object.assign({}, ...runs.slice(3 * s, 3 * s + 3)),
  }));
});

test('a moving list with no shadowed light sums what the still image sums, bit for bit', () => {
  let differed = 0;
  for (const { name, sums } of readings) {
    const { moving, drawn, still } = sums;
    assertSameBits(moving, still, name);
    assert.ok(still.some(Boolean), `${name}: the samples are lit`);
    differed += +drawn.some((word, i) => word !== still[i]);
  }
  // Drawing changed the sums of the lists it drew: the moving image's sum really changed.
  assert.ok(differed >= 5, `${differed} sets drawn differently from the still sum`);
});

test('a moving list holding a shadowed light sums what it was drawn to, bit for bit', () => {
  for (const { name, sums } of readings) assertSameBits(sums.shadowMoving, sums.shadowDrawn, name);
});

test('the moving program with no rectangle code sums what the full one does, bit for bit', () => {
  for (const { name, sums } of readings) assertSameBits(sums.rectless, sums.shadowMoving, name);
});
