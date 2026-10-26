// A camera cut the device cannot hold is refused by name before any buffer: the host says
// why the session is refused, instead of a GPU cut gone without a word. A dispatch is not one of
// them: past one dimension, it runs in rows; nor is a table past one binding, a record table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { dagDeviceRefusal } from './deviceRefusal.ts'
import { cameraCutBuffers } from './bufferTable.ts'
import { createGpuDagSelection } from './selection/selection.ts'
import { packDagSelection } from './pack/pack.ts'
import type { PackedDag } from './types.ts'
import { dagFixture } from '../selection/dag.fixture.ts'
import { packed } from './selection/selectionHelpers.fixture.ts'
import { hostStretches } from './hostStretches.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

const LIMIT = 64 << 10
/** A thousand pages over ten nodes and ten primitives, `big` past one 64 KiB binding. */
const dag = (big?: 'clusters' | 'nodes' | 'worlds' | 'coldWords') =>
  ({
    pageCount: 1000,
    nodeCount: 10,
    worldCount: 10,
    ...Object.fromEntries(
      (['clusters', 'nodes', 'worlds', 'coldWords'] as const).map((name) => [
        name,
        new Float32Array(name === big ? LIMIT : 16),
      ]),
    ),
  }) as unknown as PackedDag

test('every table past one binding is a record table: five storage buffers, whatever the world', () => {
  const limits = { maxStorageBufferBindingSize: LIMIT, maxComputeWorkgroupsPerDimension: 65535 }
  assert.equal(dagDeviceRefusal(limits, dag()), undefined, 'under every limit: the cut of before')
  for (const name of ['clusters', 'nodes', 'worlds', 'coldWords'] as const)
    assert.equal(dagDeviceRefusal(limits, dag(name)), undefined, `${name}: a record table`)
  // The readout, `work`, the list of visible clusters and the clusters' records and edges alone are
  // storage buffers: a stage of five holds the cut.
  assert.equal(
    dagDeviceRefusal({ ...limits, maxStorageBuffersPerShaderStage: 5 }, dag()),
    undefined,
  )
  assert.equal(
    dagDeviceRefusal({ ...limits, maxStorageBuffersPerShaderStage: 4 }, dag())?.buffer,
    'storage bindings',
  )
  // The flags too: every section at its cap, past one binding if it must, in its record table.
  // The binding holds the largest storage buffer — the clusters' records, 44 bytes a page — and no
  // more; twenty thousand roots' descent array, their root slots beside as many nodes, is 320,000
  // bytes.
  const roots = { ...dag(), worldCount: 20000, nodeCount: 20000 }
  const rowSizes = Object.values(cameraCutBuffers(roots).rows).map((row) => row.size)
  const section = { maxStorageBufferBindingSize: Math.max(...rowSizes) }
  const { shape } = cameraCutBuffers(roots)
  assert.ok(
    shape.queueWords * 4 > section.maxStorageBufferBindingSize,
    'the roots past one binding',
  )
  assert.equal(dagDeviceRefusal(section, roots), undefined, 'the roots past one binding held')
})

test('`work` holds no word per page: the binding holds the list of visible clusters and the records', () => {
  // The list of visible clusters and the clusters' records are storage buffers a binding must hold;
  // the lists of `flags` are in a record table, past it if they must.
  const pages = dag()
  const rows = cameraCutBuffers(pages).rows
  // 376 bytes: the two masks of the blended clusters, sixteen blocks of two words each, the twenty-
  // nine frame counters — the lists' group counts among them —, then the word of the filter's bits
  // that the one placement takes (a bit a placement).
  assert.equal(rows.work.size, 376, `\`work\` is ${rows.work.size} bytes for a thousand pages`)
  const largest = Math.max(...Object.values(rows).map((row) => row.size))
  assert.equal(dagDeviceRefusal({ maxStorageBufferBindingSize: largest }, pages), undefined)
  assert.equal(
    (dagDeviceRefusal({ maxStorageBufferBindingSize: largest - 1 }, pages) as { bytes?: number })
      ?.bytes,
    largest,
    'one byte under the largest: refused by it',
  )
  assert.equal(cameraCutBuffers(pages).visibleCap, 1000)
})

test('a dispatch past the workgroups of one dimension is not refused: it runs in rows', () => {
  const limits = { maxStorageBufferBindingSize: LIMIT, maxComputeWorkgroupsPerDimension: 15 }
  assert.equal(dagDeviceRefusal(limits, dag()), undefined, '16 groups of pages, rows of 15')
})

test('the host is told why, and no buffer is made', async () => {
  const [root] = packed(dagFixture()).roots
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 64, maxBufferSize: 1 << 20 } })
  const refusals: unknown[] = []
  const one = packDagSelection([root])
  const selection = await createGpuDagSelection(fake.device, one, {
    roots: hostStretches(one),
    onRefused: (reason, details) => refusals.push({ reason, ...details }),
  })
  assert.equal(selection, undefined)
  assert.equal(fake.buffers.length, 0)
  assert.equal(refusals.length, 1)
  // `work` is no record table: the binding cannot hold it.
  assert.match(JSON.stringify(refusals[0]), /past the device limits.*"buffer":"work"/)
})
