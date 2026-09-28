// A camera cut whose flags pass one binding makes them in parts, binds each at once, and hands its
// mask readers the part that holds the draw mask, at its offset there; its light cut cuts its own
// flags at the same sections and logs its drawn pages in one part (#974).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDagResources } from './resources.ts';
import { createDagRuntime } from './runtime.ts';
import { createDagLightCut } from './lightCut.ts';
import { dagPartBindings } from './shader/bindings.ts';
import { dagPartCounts } from './shader/splitWgsl.ts';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { packed } from './selectionHelpers.fixture.ts';
import { SHADOW_LIMITS } from '../../webgpu/pages/testScenes.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('flags past one binding: parts, all bound, the mask and the drawn log each in one', async () => {
  const { dag } = packed(dagFixture());
  const words = Math.max(dag.pageCount, dag.nodeCount, dag.worldCount);
  const limit = Math.max(96, 4 * words);
  const fake = fakeDevice({
    limits: {
      ...SHADOW_LIMITS,
      maxStorageBufferBindingSize: limit,
      maxStorageBuffersPerShaderStage: 64,
    },
  });
  const resources = (await createDagResources(fake.device, dag, true))!;
  assert.ok(resources.flagParts.length > 1, 'flags in parts');
  for (const part of resources.flagParts) assert.ok(part.size <= limit, 'each within a binding');
  const extra = dagPartBindings(dagPartCounts(resources.split)).map(({ binding }) => binding);
  const group = fake.bindGroups[fake.bindGroups.length - 1];
  const bound = [...group.entries].map(({ binding }) => binding);
  for (const binding of extra) assert.ok(bound.includes(binding), `binding ${binding} bound`);

  const selection = createDagRuntime(resources);
  assert.ok(resources.flagParts.includes(selection.maskBuffer), 'the mask is one part');
  assert.ok((selection.maskOffset + dag.pageCount) * 4 <= selection.maskBuffer.size);

  const cut = createDagLightCut(resources);
  const log = cut.drawnLog;
  assert.ok((log.offset + dag.pageCount) * 4 <= log.buffer.size, 'the drawn log in one part');
});
