// #831: the GPU's own page draws pick each caster's level per page, from the page's texel size, as
// the host's light cut does: a coarse page draws the coarse form of a surface, a fine page its fine
// form, never both — a far page no longer draws the whole field at its finest. Run from the shipped
// WGSL (`freshCullWgsl.ts`) on the rows' detail as the host writes it (`rowLods.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { MOBILITY_CORNER_SHIFT } from '../../gpu/shadow/cullShader.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { FRESH_ARG, FRESH_PARAMS, freshArgWords } from './freshLayout.ts';
import { runShadowPairs } from './freshRun.fixture.ts';
import { ROW_LOD_FLOATS, writeRowLod } from './rowLodWords.ts';

const IDENTITY = { world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };
/** A cluster at the origin of error `lodError`, replaced by a group of error `parentError`. */
const cluster = (lodError: number, parentError: number | null) =>
  ({
    lodError,
    parentError,
    sphere: [0, 0, 0, 1],
    parentSphere: [0, 0, 0, 2],
    level: 1,
  }) as PageRec;

test('a coarse page drawn by the GPU selects a coarser level of a caster than a fine page', () => {
  // Two sun pages over the same caster: a fine one, 100 texels a metre, and a coarse one, 5.
  const texels = [100, 5],
    volumes = new Float32Array(2 * SHADOW_CULL_FLOATS);
  texels.forEach((texel, k) => {
    volumes.set([0, 0, 0, 10, 0, 0, 1, -1, 1, 0, 0, 10, 0, 1, 0, 10], k * SHADOW_CULL_FLOATS);
    volumes[k * SHADOW_CULL_FLOATS + 18] = texel;
  });
  // Row 0: the fine form, 5 mm of error under its parent's 10 cm; row 1: that parent, the root.
  const lods = new Float32Array(2 * ROW_LOD_FLOATS);
  writeRowLod(lods, 0, cluster(0.005, 0.1), IDENTITY);
  writeRowLod(lods, 1, cluster(0.1, null), IDENTITY);
  const spheres = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2]),
    mobility = Uint32Array.of(3 << MOBILITY_CORNER_SHIFT, 3 << MOBILITY_CORNER_SHIFT),
    params = new Uint32Array(FRESH_PARAMS),
    args = new Uint32Array(freshArgWords(4)),
    pairs = new Uint32Array(16);
  params.set([4, 2, 1, 2, 2, 2, 8]);
  new Float32Array(params.buffer)[7] = 1; // a texel of error, the light cuts' threshold
  args[FRESH_ARG.regions] = 2;
  runShadowPairs(
    ...[spheres, params, volumes, pairs, args, mobility, lods].map((a) => new Uint8Array(a.buffer)),
  );
  const kept = Array.from({ length: args[FRESH_ARG.pairs] }, (_, i) => [
    pairs[2 * i],
    pairs[2 * i + 1],
  ]);
  const rowsOf = (k: number) => kept.filter(([region]) => region === k).map(([, row]) => row);
  assert.deepEqual(rowsOf(0), [0], 'the fine page: the fine form alone');
  assert.deepEqual(rowsOf(1), [1], 'the coarse page: the coarse form alone');
});

test('a row’s detail folds the cut’s residency in: unready never drawn, finer group missing drawn', () => {
  const out = new Float32Array(ROW_LOD_FLOATS),
    rec = cluster(0.1, 0.4),
    at = (ready: boolean, childReady: boolean) => {
      writeRowLod(out, 0, rec, IDENTITY, ready, childReady);
      return [out[3], out[7]];
    };
  assert.deepEqual(
    at(true, true).map((v) => Math.fround(v)),
    [Math.fround(0.1), Math.fround(0.4)],
  );
  assert.equal(at(false, true)[1], 0, 'not ready: no page reaches its parent error');
  assert.equal(at(true, false)[0], 0, 'its finer group missing: every page wants it');
  writeRowLod(out, 0, undefined, IDENTITY);
  assert.equal(out[3], 0, 'no record, as a blended caster: drawn by every page');
  assert.ok(out[7] > 1e38, 'its parent error past any page');
});
