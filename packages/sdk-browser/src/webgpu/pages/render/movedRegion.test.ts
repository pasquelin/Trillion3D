// CPU-14 at the move: a root whose box follows it stales the temporal pyramid where it stood and
// stands — the union of the two boxes the shadow scheduler hears — and keeps the rest; a root
// whose box cannot follow it drops the whole pyramid, as develop did for every move.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { setWebgpuTransform } from './transform.ts';
import { selectionRoot, runtime, scene } from '../../core/transformShear.fixture.ts';

const moved = new Float32Array(new G.Matrix4().makeTranslation(4, -2, 1).elements);

test('a moved root stales its motion box alone and keeps the pyramid', () => {
  const { source, mesh, worlds } = scene();
  const root = selectionRoot(mesh, [-1, -1, -1, 1, 1, 1], worlds);
  const { rt, run, motions } = runtime(source, [root], worlds);
  const pyramid = run.temporalHizState.pyramid;
  setWebgpuTransform(rt, 'target', moved);
  assert.equal(run.temporalHizState.pyramid, pyramid, 'the pyramid is kept');
  const [stale] = run.temporalHizState.stale!;
  assert.equal(run.temporalHizState.stale!.length, 1);
  assert.deepEqual([...stale.min, ...stale.max], [-1, -3, -1, 5, 1, 2], 'where it was and is');
  // The shadow scheduler hears the two boxes apart (#1345): the pages between them keep.
  assert.deepEqual(
    motions.map(({ min, max }) => [...min, ...max]),
    [
      [-1, -1, -1, 1, 1, 1],
      [3, -3, 0, 5, -1, 2],
    ],
  );
});

test('a root with no box to follow drops the whole pyramid', () => {
  const { source, mesh, worlds } = scene();
  const root = selectionRoot(mesh, [-1, -1, -1, 1, 1, 1], worlds);
  delete root.localBox;
  const { rt, run } = runtime(source, [root], worlds);
  setWebgpuTransform(rt, 'target', moved);
  assert.equal(run.temporalHizState.pyramid, undefined);
  assert.equal(run.temporalHizState.camera, undefined);
});
