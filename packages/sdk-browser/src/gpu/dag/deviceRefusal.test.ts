// A camera cut the device cannot hold is refused by name before any buffer (#973): the host says
// why the CPU cut draws, instead of a GPU cut gone without a word.
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

test('each camera cut buffer past one binding is refused by its name', () => {
  const limits = { maxStorageBufferBindingSize: LIMIT, maxComputeWorkgroupsPerDimension: 65535 };
  assert.equal(dagDeviceRefusal(limits, dag()), undefined, 'under every limit: the cut of before');
  for (const name of ['clusters', 'nodes', 'worlds', 'pageCones'] as const)
    assert.deepEqual(dagDeviceRefusal(limits, dag(name)), {
      buffer: name,
      bytes: 4 * LIMIT,
      limit: LIMIT,
    });
  const tiny = { maxStorageBufferBindingSize: 4096, maxBufferSize: 1 << 20 };
  assert.equal(dagDeviceRefusal(tiny, dag())?.buffer, 'flags');
});

test('a flat dispatch past the workgroups of one dimension is refused', () => {
  const limits = { maxStorageBufferBindingSize: LIMIT, maxComputeWorkgroupsPerDimension: 15 };
  assert.deepEqual(dagDeviceRefusal(limits, dag()), {
    dispatch: 'workgroups',
    workgroups: 16,
    limit: 15,
  });
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
  assert.match(JSON.stringify(refusals[0]), /past the device limits.*"buffer":"clusters"/);
});
