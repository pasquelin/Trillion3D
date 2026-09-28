// A camera cut's buffers, its light cut's and the device check read one table (#974): the check
// and the capacity judge exactly the sizes the cuts make, under one fit rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraCutBuffers, lightCutBuffers, pastBinding, readoutRow } from './bufferTable.ts';
import { createDagResources } from './resources.ts';
import { createDagLightCut } from './lightCut.ts';
import { dagDeviceRefusal } from './deviceRefusal.ts';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { packed } from './selectionHelpers.fixture.ts';
import { SHADOW_LIMITS } from '../../webgpu/pages/testScenes.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('the camera cut and its light cut make the buffers their table names', async () => {
  const { dag } = packed(dagFixture());
  const fake = fakeDevice({ limits: SHADOW_LIMITS });
  const resources = (await createDagResources(fake.device, dag, true))!;
  const made = (label: string) => fake.buffers.filter((b) => b.label === label).map((b) => b.size);
  const camera = cameraCutBuffers(dag);
  for (const row of [...Object.values(camera.rows), readoutRow(resources.listCap)])
    assert.deepEqual(made(row.label), [row.size], row.label);
  const cut = createDagLightCut(resources);
  const light = lightCutBuffers(resources, cut.capacity);
  for (const row of Object.values(light.rows)) assert.deepEqual(made(row.label), [row.size]);
  const frames = resources.frames.ranges.map(({ count }) => light.frames(count).size);
  assert.deepEqual(made(light.frames(1).label), frames, 'one per range of the camera');
});

test('the device check refuses the first row past one binding, by the one rule', () => {
  const { dag } = packed(dagFixture());
  const rows = { ...cameraCutBuffers(dag).rows, out: readoutRow(1) };
  const largest = Math.max(...Object.values(rows).map((row) => row.size));
  const limits = { maxStorageBufferBindingSize: largest - 1 };
  const past = pastBinding(limits, rows);
  assert.equal(past?.bytes, largest);
  assert.deepEqual(dagDeviceRefusal(limits, dag), past, 'the check is the rule on the table');
  assert.equal(pastBinding({ maxStorageBufferBindingSize: largest }, rows), undefined);
});
