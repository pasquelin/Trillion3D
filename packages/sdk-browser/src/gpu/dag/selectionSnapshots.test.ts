// The rules the snapshot must hold between two frames, and that nothing proved.
//
// `selectionInvalidation.test.ts` covers the RESIDENCY half of the in-flight snapshot guard; the
// WORLD half was not, nor the fact that a copy only leaves when a readback is due. Both become
// holes as soon as the cut is published as something other than a complete list: a snapshot
// drawn after a world change describes a scene that no longer exists, and a useless copy
// takes a readback slot the next frame will no longer have.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuDagSelection } from './selection.ts';
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts';
import { mockDagDevice } from './selection.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { gatedDag, kernelUniforms, packed } from './selectionHelpers.fixture.ts';
import type { GpuCut } from '../core/selection.ts';
import {
  fixturePages,
  fixtureUniforms,
  mountCutAdopter,
  peekOnly,
} from '../../webgpu/cut/adopter.fixture.ts';

test('an in-flight snapshot that a world change crosses lands marked as cut under the old pose', async () => {
  const { release, fixture, dag, uniforms, device } = gatedDag();
  const selection = await createGpuDagSelection(device, dag);
  assert.ok(selection);
  selection.dispatch(uniforms);
  // The primitive moves a thousand units WHILE the snapshot is in flight: what it reports
  // describes the previous pose. It still says what to stream, but it is marked, so nothing lets
  // it become the frame's drawn cut (`adoption.ts`).
  const moved = dag.worlds.slice();
  moved[12] = 1000;
  assert.equal(selection.updateWorlds(moved), true);
  release();
  assert.equal((await selection.flush())?.pageIds.length, 4);
  assert.equal(selection.peek()?.stalePose, true);
  selection.dispose();
  fixture.geometry.dispose();
});

test('a snapshot copy only leaves when a readback is due', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const { device, readbackCopies } = mockDagDevice(dag);
  const selection = await createGpuDagSelection(device, dag);
  assert.ok(selection);
  selection.dispatch(uniforms);
  await selection.flush();
  assert.equal(readbackCopies(), 1, 'the first frame reads back');
  // Same uniforms, same residency: the held snapshot already describes this frame. No compute,
  // and above all no copy — it would take a slot to report what is already there.
  selection.dispatch(uniforms);
  selection.dispatch(uniforms);
  await selection.flush();
  assert.equal(readbackCopies(), 1, 'nothing changed, nothing is copied');
  selection.dispose();
  fixture.geometry.dispose();
});

test('a residency republished identically does not drop the held cut', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const { device } = mockDagDevice(dag);
  const selection = await createGpuDagSelection(device, dag, { residentCut: true });
  assert.ok(selection);
  const resident = new Uint32Array(dag.pageCount).fill(1);
  assert.equal(selection.updateResidency(resident), true);
  selection.dispatch(uniforms);
  assert.ok(await selection.flush());
  assert.ok(selection.peek(), 'the cut is held');
  assert.equal(selection.updateResidency(resident.slice()), false, 'no bit has moved');
  assert.ok(selection.peek(), 'and the held cut was not dropped');
  selection.dispose();
  fixture.geometry.dispose();
});

test('a disposal with both readbacks in flight maps none of the buffers it destroyed', async () => {
  const { release, fixture, dag, uniforms, device, destroyedMaps } = gatedDag();
  const selection = await createGpuDagSelection(device, dag);
  assert.ok(selection);
  // Two snapshots in flight: slot 0 is mapping, held by the gate; slot 1's read waits behind it.
  selection.dispatch(uniforms);
  selection.dispatch({ ...uniforms, pixelError: uniforms.pixelError + 1 });
  await new Promise(setImmediate);
  // The world reopens its session here: slot 0's mapping is cut short (`AbortError`), and slot 1's
  // read starts after its buffer is gone. Neither maps a destroyed buffer (#334).
  selection.dispose();
  release();
  await selection.flush();
  assert.equal(destroyedMaps(), 0);
  fixture.geometry.dispose();
});

// A placement moved on every frame (#358, defect 4): three small loaded models carried beside a
// compiled terrain left the cut with no readback to adopt, frame after frame — `selectedTriangles`
// 0, the terrain held at its coarsest level. A readback cut under poses that have moved since
// still names the pages to stream; it only stops describing what the image draws.
const FRAMES = 30;

test('a placement moved every frame still leaves a readback for every frame to stream from', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const selection = await createGpuDagSelection(mockDagDevice(dag).device, dag);
  assert.ok(selection);
  const moving = dag.worlds.slice();
  let streamed = 0,
    posed = 0;
  // The engine's order (`render.ts`): the moved worlds are sent, then the frame adopts what the
  // last readback reported, then it dispatches its own cut; that readback lands between frames.
  for (let frame = 0; frame < FRAMES; frame++) {
    moving[12] += 0.001;
    assert.equal(selection.updateWorlds(moving), true, 'the pose moved');
    const cut = selection.peek();
    if (cut) {
      streamed++;
      if (!cut.stalePose) posed++;
    }
    selection.dispatch(uniforms);
    await new Promise(setImmediate);
  }
  assert.equal(streamed, FRAMES - 1, 'every frame after the first has a cut to stream from');
  assert.equal(posed, 0, 'none of them is taken for the pose the frame draws');
  // The model stops: the next readback is cut under the poses in place, and describes the image.
  selection.dispatch(uniforms);
  await selection.flush();
  assert.equal(selection.peek()?.stalePose, false);
  assert.equal(selection.peek()?.result.pageIds.length, 4);
  selection.dispose();
  fixture.geometry.dispose();
});

test('a cut under a pose that has moved streams its pages and draws nothing of its own', () => {
  const uniforms = fixtureUniforms();
  const cutOf = (stalePose: boolean): GpuCut => ({
    uniforms,
    result: { pageIds: [0, 1, 2], drawablePageIds: [0, 1], frustumRejected: 0, lodLevel: 0 },
    stalePose,
  });
  let peeked = cutOf(true);
  const { adopter, desired, shown } = mountCutAdopter({
    packedPages: fixturePages(3),
    residentOffsetWords: new Int32Array(3),
    uniforms,
    selection: () => peekOnly(() => peeked),
  });
  assert.equal(adopter.adopt(), false, 'not the pose this image draws');
  assert.deepEqual(
    desired.map((page) => page.url),
    ['p0', 'p1', 'p2'],
    'its pages are asked of the cache all the same',
  );
  assert.equal(shown.length, 0, 'and it names nothing drawn');
  peeked = cutOf(false);
  assert.equal(adopter.adopt(), true, 'the model stopped: the next cut describes the image');
  assert.deepEqual(
    shown.map((page) => page.url),
    ['p0', 'p1'],
  );
});
