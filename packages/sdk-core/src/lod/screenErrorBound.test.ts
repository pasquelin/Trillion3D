// #980, VIS-16: the frame's four scalars (stretch, focal length, near plane, projection) are
// checked once, `frameParametersSound`, and each cluster only its own values, `clusterErrorInFrame`.
// Against a frozen copy of the per-cluster guard: the same value to the bit, the same error on the
// same call, over random clusters and every edge (NaN, ±0, ±Inf, degenerate projection).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterErrorAtDepth,
  clusterErrorInFrame,
  frameParametersSound,
  screenErrorBound,
} from './screenErrorBound.ts';

/** `clusterErrorAtDepth` as it stood before #980: all thirteen conditions on every call. */
function perCluster(
  clusterError: number,
  stretch: number,
  lateral: number,
  depth: number,
  radius: number,
  focal: number,
  near: number,
  perspective = 1,
): number {
  if (clusterError === 0) return 0;
  if (clusterError === Infinity) return Infinity;
  if (
    !Number.isFinite(clusterError) ||
    clusterError < 0 ||
    !Number.isFinite(stretch) ||
    stretch < 0 ||
    !Number.isFinite(radius) ||
    radius < 0 ||
    !Number.isFinite(focal) ||
    focal <= 0 ||
    !Number.isFinite(near) ||
    near <= 0 ||
    !(lateral >= 0 && lateral < Infinity) ||
    !Number.isFinite(depth) ||
    !(perspective >= 0 && perspective <= 1)
  ) {
    throw new Error('Invalid cluster parameters');
  }
  return screenErrorBound(clusterError, stretch, lateral, depth, radius, focal, near, perspective);
}

type Args = [number, number, number, number, number, number, number, number | undefined];

/** The value, or the thrown error's name and message. */
function outcome(run: () => number): number | string {
  try {
    return run();
  } catch (error) {
    return `${(error as Error).name}: ${(error as Error).message}`;
  }
}

/** The CPU cut's way (`projectedErrorAt`): 0 and ∞ returned as is, then the frame checked once,
 *  the cluster through `clusterErrorInFrame` when it passed, through the whole guard otherwise. */
function checkedOnce(a: Args) {
  const [error, stretch, lateral, depth, radius, focal, near, perspective = 1] = a;
  if (error === 0) return 0;
  if (error === Infinity) return Infinity;
  return frameParametersSound(stretch, focal, near, perspective)
    ? clusterErrorInFrame(error, stretch, lateral, depth, radius, focal, near, perspective)
    : clusterErrorAtDepth(...a);
}

function assertSame(a: Args) {
  const expected = outcome(() => perCluster(...a));
  for (const [name, run] of [
    ['clusterErrorAtDepth', () => clusterErrorAtDepth(...a)],
    ['checked once', () => checkedOnce(a)],
  ] as const) {
    const got = outcome(run);
    assert.ok(Object.is(got, expected), `${name}(${a.join(', ')}): ${got} against ${expected}`);
  }
  return expected;
}

const EDGES = [NaN, 0, -0, Infinity, -Infinity, -1, 1e-300, 0.5, 1, 2, 1e300];

test('every edge of every argument gives the per-cluster verdict, to the bit', () => {
  const base: Args = [0.02, 1.5, 3, 40, 0.8, 900, 0.1, 1];
  for (let slot = 0; slot < base.length; slot++)
    for (const value of [...EDGES, undefined]) {
      const a = [...base] as Args;
      a[slot] = value as number;
      assertSame(a);
    }
  // Degenerate projections and an out-of-range weight, with each cluster kind.
  for (const perspective of [0, -0, 1, 0.5, 1 + 2 ** -52, -(2 ** -1074), NaN, undefined])
    for (const error of [0, Infinity, 0.02, NaN, -1])
      for (const [depth, near] of [
        [40, 0.1],
        [0.1, 0.1],
        [-5, 0.1],
        [40, 0],
      ])
        assertSame([error, 1, 3, depth, 0.8, 900, near, perspective]);
});

test('20,000 random clusters and frames give the per-cluster verdict, to the bit', () => {
  let seed = 980;
  const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const pick = (scale: number) => {
    const r = random();
    if (r < 0.04) return EDGES[Math.floor(random() * EDGES.length)];
    return (random() < 0.1 ? -1 : 1) * scale * random() ** 3;
  };
  let projected = 0,
    refused = 0;
  for (let i = 0; i < 20_000; i++) {
    const verdict = assertSame([
      pick(1),
      pick(3),
      pick(50),
      pick(200) * (random() < 0.8 ? 1 : -1),
      pick(10),
      pick(4000),
      pick(1),
      random() < 0.2 ? pick(1.2) : random() < 0.5 ? 1 : 0,
    ]);
    if (typeof verdict === 'string') refused++;
    else if (verdict > 0 && verdict < Infinity) projected++;
  }
  // Both sides of the guard are walked, not only one.
  assert.ok(projected > 5000 && refused > 1000, `${projected} projected, ${refused} refused`);
});
