// What the resolve probes share (#849, #1249): a seeded draw, samples of each lit model, and the
// run of `narrowResolvePage.ts` on a headless WebGPU page.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seeded } from '../../../site/examples/kit/random.ts';
import { dansPageWebgpu, bundlePage } from './pageWebgpu.ts';
import type { ResolveScene, run } from './narrowResolvePage.ts';

declare global {
  var narrowResolve: { run: typeof run };
}

const here = dirname(fileURLToPath(import.meta.url));

/** A seeded draw: a number in a range, a vector in a cube, a unit vector. */
export function resolveRandom(seed: number) {
  const r = seeded(seed);
  const between = (low: number, high: number) => low + r() * (high - low);
  const vector = (size: number) => [
    between(-size, size),
    between(-size, size),
    between(-size, size),
  ];
  const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v)) as [number, number, number];
  return { r, between, vector, unit };
}

/** `count` points in a two-metre box and their samples: a surface of each lit model (standard,
 *  diffuse, toon). */
export function resolveSamples(count: number, draw: ReturnType<typeof resolveRandom>) {
  const { r, between, vector, unit } = draw;
  const points = Array.from({ length: count }, () => vector(1));
  const samples = points.flatMap((P, k) => [
    ...[between(0.1, 1), between(0.1, 1), between(0.1, 1), r() < 0.3 ? 1 : 0],
    ...[...unit(vector(1)), between(0.05, 1)],
    ...[...P, between(0.5, 1)],
    ...[...unit([between(-0.5, 0.5), between(-0.5, 0.5), 1]), [2, 4, 5][k % 3]],
  ]);
  return { points, samples };
}

/** A cell's record as the grid pass writes it (#1369), its list after it in the same buffer: its
 *  count, the high bit set when a listed rank of `shadowed` holds a shadow slot, then where its list
 *  starts — word 2 —, or with no `room` in the pool `TILE_NO_SLICE`: every light of the scene. */
export const cellRecord = (list: number[], shadowed: number[] = [], room = true) => [
  (list.length | (list.some((rank) => shadowed.includes(rank)) ? 0x80000000 : 0)) >>> 0,
  room ? 2 : 0xffffffff,
  ...(room ? list : []),
];

/** The sums of each record of each scene, as f32 bits; the page's errors, and with
 *  `pageErrors` its uncaught ones, must be none. */
export async function runResolves(scenes: ResolveScene[], titre: string, pageErrors?: string[]) {
  const script = await bundlePage(resolve(here, 'narrowResolvePage.ts'), 'narrowResolve');
  const result = await dansPageWebgpu(
    (list: ResolveScene[]) => globalThis.narrowResolve.run(list),
    scenes,
    { titre, script, erreursPage: pageErrors },
  );
  assert.equal(result.unavailable, undefined, 'WebGPU must be available');
  const { errors, runs } = result as Exclude<typeof result, { unavailable: string }>;
  assert.deepEqual([...errors, ...(pageErrors ?? [])], []);
  return runs;
}
