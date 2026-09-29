// A camera cut the device cannot hold is refused by name before any buffer (#973): the host says
// why the CPU cut draws, instead of a GPU cut gone without a word. A dispatch is no longer one of
// them: past one dimension, it runs in rows; nor a table past one binding, split in parts (#974).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dagDeviceRefusal } from './deviceRefusal.ts';
import { createGpuDagSelection, packDagSelection, type PackedDag } from './selection.ts';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { packed } from './selectionHelpers.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

const LIMIT = 64 << 10;
/** A thousand pages over ten nodes and ten primitives, `big` past one 64 KiB binding. */
const dag = (big?: 'clusters' | 'nodes' | 'worlds' | 'pageCones') =>
  ({
    pageCount: 1000,
    nodeCount: 10,
    worldCount: 10,
    ...Object.fromEntries(
      (['clusters', 'nodes', 'worlds', 'pageCones'] as const).map((name) => [
        name,
        new Float32Array(name === big ? LIMIT : 16),
      ]),
    ),
  }) as unknown as PackedDag;

test('a table past one binding splits in parts the device binds at once, instead of refused', () => {
  const limits = { maxStorageBufferBindingSize: LIMIT, maxComputeWorkgroupsPerDimension: 65535 };
  const wide = { ...limits, maxStorageBuffersPerShaderStage: 16 };
  assert.equal(dagDeviceRefusal(limits, dag()), undefined, 'under every limit: the cut of before');
  assert.equal(dagDeviceRefusal(limits, dag('worlds')), undefined, 'worlds split in ranges');
  for (const name of ['clusters', 'nodes', 'pageCones'] as const) {
    assert.equal(dagDeviceRefusal(wide, dag(name)), undefined, `${name} in parts`);
    assert.equal(
      dagDeviceRefusal(limits, dag(name))?.buffer,
      'storage bindings',
      `${name}: its parts past WebGPU's eight bindings, the CPU cut draws`,
    );
  }
  const tiny = { maxStorageBufferBindingSize: 6144, maxBufferSize: 1 << 20 }; // the readout (4,204 bytes) fits, flags do not
  assert.equal(
    dagDeviceRefusal({ ...tiny, maxStorageBuffersPerShaderStage: 16 }, dag()),
    undefined,
    'flags in parts of whole sections',
  );
  const section = { maxStorageBufferBindingSize: 2048, maxStorageBuffersPerShaderStage: 64 };
  assert.match(dagDeviceRefusal(section, dag())?.buffer ?? '', /^flags/, 'a page section past');
});

test('a dispatch past the workgroups of one dimension is not refused: it runs in rows', () => {
  const limits = { maxStorageBufferBindingSize: LIMIT, maxComputeWorkgroupsPerDimension: 15 };
  assert.equal(dagDeviceRefusal(limits, dag()), undefined, '16 groups of pages, rows of 15');
});

test('the host is told why, and no buffer is made', async () => {
  const [root] = packed(dagFixture()).roots;
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 64, maxBufferSize: 1 << 20 } });
  const refusals: unknown[] = [];
  const selection = await createGpuDagSelection(fake.device, packDagSelection([root]), {
    onRefused: (reason, details) => refusals.push({ reason, ...details }),
  });
  assert.equal(selection, undefined);
  assert.equal(fake.buffers.length, 0);
  assert.equal(refusals.length, 1);
  assert.match(JSON.stringify(refusals[0]), /past the device limits.*"buffer":"nodes"/);
});
