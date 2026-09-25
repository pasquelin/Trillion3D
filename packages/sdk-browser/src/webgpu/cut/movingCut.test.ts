import test from 'node:test';
import assert from 'node:assert/strict';
import { fixturePages, mountCutAdopter } from './adopter.fixture.ts';
import { createGpuDagSelection } from '../../gpu/dag/selection.ts';
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts';
import { mockDagDevice } from '../../gpu/dag/selection.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { kernelUniforms, packed } from '../../gpu/dag/selectionHelpers.fixture.ts';

// A loaded model moved on every frame (#358, defect 4). Each move used to drop the cut in hand and
// every readback in flight: no cut was ever adopted, `selectedTriangles` stayed 0 and the terrain
// at its coarsest level. A cut read back under a pose a placement has left since only chooses the
// clusters — the draw reads this frame's mask — so it is adopted one frame late, as a camera's is;
// it only never lets an image be held.
const FRAMES = 30;

/** A resident-cut selection, all its pages resident, and an adopter wired as the engine wires it. */
async function bench() {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const selection = await createGpuDagSelection(mockDagDevice(dag).device, dag, {
    residentCut: true,
  });
  assert.ok(selection);
  selection.updateResidency(new Uint32Array(dag.pageCount).fill(1));
  const { adopter } = mountCutAdopter({
    packedPages: fixturePages(dag.pageCount),
    uniforms,
    selection: () => selection,
  });
  /** One image in the engine's order (`render.ts`): worlds sent, readback adopted, cut dispatched;
   *  the readback lands between images. */
  const frame = async (worlds: Float32Array, posesMoved: boolean) => {
    selection.updateWorlds(worlds, posesMoved);
    const adopted = adopter.adopt();
    selection.dispatch(uniforms);
    await new Promise(setImmediate);
    return adopted;
  };
  const dispose = () => (selection.dispose(), fixture.geometry.dispose());
  return { dag, uniforms, selection, adopter, frame, dispose };
}

test('a model moved every frame has a cut adopted on every frame, counted and never held', async () => {
  const { dag, selection, adopter, frame, dispose } = await bench();
  const moving = dag.worlds.slice();
  const start = moving[12];
  for (let n = 0; n < FRAMES; n++) {
    // Steps of a quarter unit, exact in single precision, back and forth in view: every frame
    // is a real move.
    moving[12] = start + 0.25 * (1 + (n % 4));
    const adopted = await frame(moving, true);
    if (n === 0) continue;
    assert.equal(adopted, true, `frame ${n}: the last readback is adopted`);
    assert.equal(adopter.metrics.ready, true, 'the GPU metrics are ready');
    assert.ok(adopter.metrics.selectedTriangles > 0, 'and the cut selects triangles');
    assert.equal(adopter.metrics.cutHeld, false, 'no image is held on a pose that has moved');
  }
  // The model stops: the next readback is cut under the poses in place, and may hold the image.
  await frame(moving, false);
  assert.equal(selection.peek()?.worldRevision, selection.worldRevision);
  assert.equal(await frame(moving, false), true);
  assert.equal(adopter.metrics.cutHeld, true);
  dispose();
});

test('a camera moving alone rebases the worlds and leaves the cut current', async () => {
  const { dag, selection, adopter, frame, dispose } = await bench();
  await frame(dag.worlds, false);
  await frame(dag.worlds, false);
  const revision = selection.worldRevision;
  const rebased = dag.worlds.slice();
  for (let n = 0; n < FRAMES; n++) {
    // The render origin follows the eye: every translation shifts by the same step.
    rebased[12] -= 0.5;
    rebased[13] += 0.25;
    assert.equal(await frame(rebased, false), true);
    assert.equal(selection.worldRevision, revision, 'nothing is marked as cut under another pose');
    assert.equal(selection.peek()?.worldRevision, revision);
  }
  assert.equal(adopter.metrics.cutHeld, true, 'the same cut, the same lists: the image may hold');
  dispose();
});

test('a drain after a move cuts again under the poses in place', async () => {
  const { dag, uniforms, selection, dispose } = await bench();
  selection.dispatch(uniforms);
  assert.equal((await selection.flush())?.pageIds.length, 4);
  const moved = dag.worlds.slice();
  moved[12] = 1000;
  selection.updateWorlds(moved);
  // Nothing dispatched since the move: the drain sends the last uniforms again, it never hands
  // back the cut of a pose that no longer exists.
  assert.equal((await selection.flush())?.pageIds.length, 0, 'the model left the view');
  assert.equal(selection.peek()?.worldRevision, selection.worldRevision);
  dispose();
});
