// A camera cut the device cannot hold is refused by name before any buffer: the host says
// why the session is refused, instead of a GPU cut gone without a word. A dispatch is not one of
// them: past one dimension, it runs in rows; nor is a table past one binding, a record table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dagDeviceRefusal } from './deviceRefusal.ts'
import { cameraCutBuffers } from './bufferTable.ts'
import { createGpuDagSelection, packDagSelection, type PackedDag } from './selection.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { packed } from './selectionHelpers.fixture.ts'
import { POOL_SORT_WORDS } from '../pool/sort.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const LIMIT = 64 << 10
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
  }) as unknown as PackedDag

test('every table past one binding is a record table: two storage buffers, whatever the world', () => {
  const limits = { maxStorageBufferBindingSize: LIMIT, maxComputeWorkgroupsPerDimension: 65535 }
  assert.equal(dagDeviceRefusal(limits, dag()), undefined, 'under every limit: the cut of before')
  for (const name of ['clusters', 'nodes', 'worlds', 'pageCones'] as const)
    assert.equal(dagDeviceRefusal(limits, dag(name)), undefined, `${name}: a record table`)
  // The readout and `work` alone are storage buffers: a stage of two holds the cut.
  assert.equal(
    dagDeviceRefusal({ ...limits, maxStorageBuffersPerShaderStage: 2 }, dag()),
    undefined,
  )
  assert.equal(
    dagDeviceRefusal({ ...limits, maxStorageBuffersPerShaderStage: 1 }, dag())?.buffer,
    'storage bindings',
  )
  // The flags too: a list starts within one binding's worth and grows no further
  // (`flagSectionCaps`); queue 0 keeps a root slot a placement past it, in its record table.
  const section = { maxStorageBufferBindingSize: 2048 }
  const roots = { ...dag(), worldCount: 1000, nodeCount: 1000 }
  assert.equal(dagDeviceRefusal(section, roots), undefined, 'the roots past one binding held')
})

test('`work` holds no word per page: a binding past one list section holds the cut', () => {
  // 12,000 bytes the live list of `flags`; the kept lists' ranks follow the readout's list
  // (`keptRanks.ts`), never the pages.
  const limits = { maxStorageBufferBindingSize: 12000 }
  assert.equal(dagDeviceRefusal(limits, dag()), undefined, 'each list its own ranks')
  const rows = cameraCutBuffers(dag(), limits).rows
  // Past the eviction sort's counts and places, a constant whatever the pages (`POOL_SORT_WORDS`).
  const perPages = rows.work.size - 4 * POOL_SORT_WORDS
  assert.ok(perPages < 1000, `\`work\` is ${perPages} bytes for a thousand pages`)
  assert.deepEqual(
    Object.keys(rows).filter((name) => name.startsWith('ranks')),
    [],
    'no ranks',
  )
  // One live word past the binding: the lists start one entry shorter, and grow no further.
  const narrow = { ...limits, maxStorageBufferBindingSize: 11996 }
  assert.equal(dagDeviceRefusal(narrow, dag()), undefined, 'the lists start within the binding')
  assert.equal(cameraCutBuffers(dag(), narrow).shape.candCap, 999)
})

test('a dispatch past the workgroups of one dimension is not refused: it runs in rows', () => {
  const limits = { maxStorageBufferBindingSize: LIMIT, maxComputeWorkgroupsPerDimension: 15 }
  assert.equal(dagDeviceRefusal(limits, dag()), undefined, '16 groups of pages, rows of 15')
})

test('the host is told why, and no buffer is made', async () => {
  const [root] = packed(dagFixture()).roots
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 64, maxBufferSize: 1 << 20 } })
  const refusals: unknown[] = []
  const selection = await createGpuDagSelection(fake.device, packDagSelection([root]), {
    onRefused: (reason, details) => refusals.push({ reason, ...details }),
  })
  assert.equal(selection, undefined)
  assert.equal(fake.buffers.length, 0)
  assert.equal(refusals.length, 1)
  // `work`, past the eviction sort's counts, is no record table: the binding cannot hold it.
  assert.match(JSON.stringify(refusals[0]), /past the device limits.*"buffer":"work"/)
})
