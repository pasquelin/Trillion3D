// The rules the snapshot must hold between two frames, and that nothing proved.
//
// `selection2.test.ts` covers the RESIDENCY half of the in-flight snapshot guard; the
// WORLD half was not, nor the fact that a copy only leaves when a readback is due. Both become
// holes as soon as the cut is published as something other than a complete list: a snapshot
// adopted after a world change describes a scene that no longer exists, and a useless copy
// takes a readback slot the next frame will no longer have.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuDagSelection } from './selection.ts';
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts';
import { mockDagDevice } from './selection.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { kernelUniforms, packed } from './selectionHelpers.fixture.ts';

test('an in-flight snapshot that a world change crosses never becomes the held cut', async () => {
  installGpuGlobals();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const selection = await createGpuDagSelection(mockDagDevice(dag, { mapGate: gate }).device, dag);
  assert.ok(selection);
  selection.dispatch(uniforms);
  // The primitive moves a thousand units WHILE the snapshot is in flight: what it reports
  // describes the previous pose, and nothing must let it become the frame's cut.
  const moved = dag.worlds.slice();
  moved[12] = 1000;
  assert.equal(selection.updateWorlds(moved), true);
  release();
  assert.equal(await selection.flush(), null);
  assert.equal(selection.peek(), null);
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
