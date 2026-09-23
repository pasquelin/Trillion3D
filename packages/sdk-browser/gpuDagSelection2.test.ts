import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuDagSelection } from './gpuDagSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { mockDagDevice } from './gpuDagSelectionFixture.ts';
import { installGpuGlobals } from '../../tests/kit/gpu/globals.ts';
import { kernelUniforms, packed } from './gpuDagSelectionTestHelpers.ts';

test("a shared command buffer is the caller's to submit, and abandoning it gives everything back", async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const { device } = mockDagDevice(dag);
  const queue = (device as unknown as { queue: { submit: () => void } }).queue,
    submitted = queue.submit;
  let submits = 0;
  queue.submit = () => {
    submits++;
    submitted.call(queue);
  };
  const selection = await createGpuDagSelection(device, dag);
  assert.ok(selection);
  const abandoned = selection.dispatch(uniforms, device.createCommandEncoder());
  assert.equal(typeof abandoned, 'function', 'a shared buffer hands back its settlement');
  assert.equal(submits, 0, 'the selection does not submit a buffer it does not own');
  abandoned!(false);
  // Nothing ran, so nothing may be remembered as run: the next image recomputes and reads back.
  const settle = selection.dispatch(uniforms, device.createCommandEncoder());
  assert.equal(typeof settle, 'function');
  settle!(true);
  assert.equal((await selection.flush())?.pageIds.length, 4);
  assert.equal(submits, 0, 'the image submits its own buffer');
  selection.dispose();
  fixture.geometry.dispose();
});

test('unchanged uniforms skip a second GPU dispatch', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const { device, uniformWrites } = mockDagDevice(dag);
  const selection = await createGpuDagSelection(device, dag);
  assert.ok(selection);
  selection.dispatch(uniforms);
  await selection.flush();
  const afterFirst = uniformWrites();
  selection.dispatch(uniforms);
  await selection.flush();
  assert.equal(uniformWrites(), afterFirst);
  selection.dispose();
  fixture.geometry.dispose();
});

test('updating an instance world matrix invalidates the old GPU cut', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const selection = await createGpuDagSelection(mockDagDevice(dag).device, dag);
  assert.ok(selection);
  selection.dispatch(uniforms);
  assert.equal((await selection.flush())?.pageIds.length, 4);
  const moved = dag.worlds.slice();
  moved[12] = 1000;
  assert.equal(selection.updateWorlds(moved), true);
  assert.equal(selection.peek(), null);
  selection.dispatch(uniforms);
  assert.equal((await selection.flush())?.pageIds.length, 0);
  selection.dispose();
  fixture.geometry.dispose();
});

test('the resident mask recomputes for residency changes with an unchanged camera', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const { device, uniformWrites } = mockDagDevice(dag);
  const selection = await createGpuDagSelection(device, dag, { residentCut: true });
  assert.ok(selection);
  const mask = () =>
    [
      ...new Uint32Array(
        (selection.maskBuffer as unknown as { data: Uint8Array }).data.buffer,
      ).slice(selection.maskOffset),
    ]
      .flatMap((flag, id) => (flag ? [dag.pageUrls[id]] : []))
      .sort();
  selection.updateResidency(Uint32Array.from(dag.pageUrls.map((url) => (url === 'root' ? 1 : 0))));
  selection.dispatch(uniforms);
  assert.deepEqual(
    (await selection.flush())?.drawablePageIds?.map((id) => dag.pageUrls[id]),
    ['root'],
  );
  assert.deepEqual(mask(), ['root']);
  selection.updateResidency(new Uint32Array(dag.pageCount).fill(1));
  assert.equal(selection.peek(), null);
  selection.dispatch(uniforms);
  assert.deepEqual(
    (await selection.flush())?.drawablePageIds?.map((id) => dag.pageUrls[id]).sort(),
    ['leaf0', 'leaf1', 'leaf2', 'leaf3'],
  );
  assert.equal(uniformWrites(), 2);
  assert.deepEqual(mask(), ['leaf0', 'leaf1', 'leaf2', 'leaf3']);
  selection.dispose();
  fixture.geometry.dispose();
});

test('a failed readback marks GPU selection dead', async () => {
  installGpuGlobals();
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const selection = await createGpuDagSelection(mockDagDevice(dag, { failMap: true }).device, dag);
  assert.ok(selection);
  selection.dispatch(uniforms);
  assert.equal(await selection.flush(), null);
  assert.equal(selection.failed(), true);
  assert.equal(selection.peek(), null);
  selection.dispose();
  fixture.geometry.dispose();
});

test('readback from an older resident cut cannot restore an invalidated drawable mask', async () => {
  installGpuGlobals();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const selection = await createGpuDagSelection(mockDagDevice(dag, { mapGate: gate }).device, dag, {
    residentCut: true,
  });
  assert.ok(selection);
  selection.updateResidency(Uint32Array.from(dag.pageUrls.map((url) => (url === 'root' ? 1 : 0))));
  selection.dispatch(uniforms);
  selection.updateResidency(new Uint32Array(dag.pageCount).fill(1));
  release();
  assert.equal(await selection.flush(), null);
  assert.equal(selection.peek(), null);
  selection.dispose();
  fixture.geometry.dispose();
});
