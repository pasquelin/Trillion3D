// #1275: the cull of the pages the GPU draws itself (`freshCullWgsl.ts`) and their seal
// (`sealShadowPages`), run from their shipped WGSL: a region keeps every caster row its volume
// touches — the page table's and the blended casters' —, one pair each; no more pages are picked
// than the pair list holds every row of, and the others wait, unread, for the next frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { MOBILITY_CORNER_SHIFT } from '../../gpu/shadow/cullShader.ts';
import { runShadowPairs } from './freshRun.fixture.ts';
import { FRESH_PARAMS, freshArgWords } from './freshLayout.ts';

const FRESH_ARG = { regions: 0, capacity: 1, pairs: 2, corners: 3 } as const;

const PAGES = 4;
/** Two regions: a box of two metres around the origin, and a cone down from five metres up. */
function volumes() {
  const floats = new Float32Array(2 * SHADOW_CULL_FLOATS);
  floats.set([0, 0, 0, 1, 0, 0, 1, -1, 1, 0, 0, 1, 0, 1, 0, 1]);
  floats.set([0, 5, 0, 10, 0, -1, 0, 0.1], SHADOW_CULL_FLOATS);
  return new Uint8Array(floats.buffer);
}
/** The cull's inputs over `rows` spheres, the table's first `tableRows` then blended ones. */
function cull(rows: number[][], tableRows: number, capacity: number) {
  const spheres = new Float32Array(rows.flat()),
    mobility = Uint32Array.from(rows, (_, row) => (row + 1) << MOBILITY_CORNER_SHIFT),
    params = new Uint32Array(FRESH_PARAMS),
    args = new Uint32Array(freshArgWords(PAGES)),
    pairs = new Uint32Array(2 * rows.length * 2);
  params.set([
    PAGES,
    2,
    1,
    tableRows,
    tableRows + 2,
    Math.max(rows.length, tableRows + 2),
    capacity,
  ]);
  args.set([2, capacity]);
  runShadowPairs(
    ...[spheres, params, volumes(), pairs, args, mobility].map((a) => new Uint8Array(a.buffer)),
  );
  const kept = Array.from({ length: Math.min(args[FRESH_ARG.pairs], capacity) }, (_, i) => [
    pairs[2 * i],
    pairs[2 * i + 1],
  ]);
  return { kept, args, params };
}

test('a region keeps every caster row its volume touches, the blended ones too', () => {
  // Rows 0 and 1 of the table, then, past two rows no draw holds, a blended caster (row 4).
  const rows = [
    [0.9, 0.9, 0, 0.1], // in the box, off the cone
    [0, 2, 0, 0.1], // in the cone, over the box
    [40, 0, 0, 0.1],
    [40, 0, 0, 0.1],
    [0, 0.5, 0, 0.1], // blended, in both
  ];
  const { kept, args } = cull(rows, 2, 64);
  const byRegion = (k: number) =>
    kept
      .filter(([region]) => region === k)
      .map(([, r]) => r)
      .sort();
  assert.deepEqual(byRegion(0), [0, 4]);
  assert.deepEqual(byRegion(1), [1, 4]);
  assert.equal(args[FRESH_ARG.corners], 5, 'the most corners a kept row draws');
});
