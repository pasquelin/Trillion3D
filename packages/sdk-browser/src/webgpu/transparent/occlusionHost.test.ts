// The transparent entries' corners are derived on the GPU from their roots' worlds
// (`entryCorners.ts`, the shipped WGSL the fake device runs), word for word the CPU oracle's. A new
// age sends every entry's inputs and the never-culled bits; a page bounded elsewhere sends its own
// entry's inputs alone; a moving glass derives its own entries again and sends no input — never
// every entry of the table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshTransparentCorners } from './occlusionHost.ts'
import { CORNER_VALUES } from '../../gpu/partition/contract.ts'
import { packPageCorners } from '../visibility/corners.fixture.ts'
import { moveRootRows } from '../pages/render/movedRoot.ts'
import { createChangedRuns } from '../residency/ranges.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

const ENTRIES = 4

/** Two glasses of two entries each, at their worlds; the roots' double worlds the GPU holds. */
function runtime() {
  const { device, writes } = fakeDevice()
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const recs = [0, 1, 2, 3].map((k) => ({ min: [k, 0, 0], max: [k + 1, 1, 1], material: {} }))
  const glass = (rank: number, x: number) =>
    ({
      world: { elements: Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 2, -3, 1) },
      pages: [0, 1].map((k) => ({ transparent: true, ...recs[rank * 2 + k] })),
      packedBase: rank * 2,
      windingCw: false,
      windingEpoch: 1,
    }) as unknown as ClusterRoot<PageRec>
  const roots = [glass(0, 5), glass(1, -7)]
  const worlds = device.createBuffer({ label: 'Trillion3D root worlds', size: 2 * 128, usage })
  /** The roots' worlds as the GPU holds them (`rootWorlds.ts`). */
  const sendWorlds = () => {
    const words = new Uint32Array(64)
    roots.forEach((root, rank) => packDoubles(words, rank * 32, root.world.elements))
    device.queue.writeBuffer(worlds, 0, words)
  }
  sendWorlds()
  const corners = device.createBuffer({ size: ENTRIES * CORNER_VALUES * 4, usage })
  let unculled = 0
  const blendState = {
    table: {
      capacity: ENTRIES,
      pageOfEntry: Int32Array.of(0, 1, 2, 3),
      entryOf: (page: number) => page,
    },
    occlusion: {
      corners,
      unculledBits: new Uint32Array(1),
      uploadUnculled: () => void unculled++,
    },
    occlusionEpoch: -1,
    occlusionMoved: { from: Infinity, to: -1 },
    occlusionPosed: createChangedRuns(),
  }
  const rt = {
    blendState,
    layout: {
      rows: { tableEpoch: 3 },
      recordOf: (page: number) => recs[page],
      selectionRoots: roots,
      placement: { baseOfRoot: Int32Array.of(0, 2), packedCount: ENTRIES },
    },
    gpu: { device },
    run: { gpuComputeDispatches: 0, movedWorlds: createChangedRuns() },
    rootWorlds: { worlds, moved: createChangedRuns() },
  } as unknown as WebgpuPagesRuntime
  /** What the corners buffer holds, and what the oracle gives at the roots' worlds. */
  const held = () => [...new Uint32Array((corners as unknown as { data: Uint8Array }).data.buffer)]
  const oracle = () => {
    const out = new Float32Array(ENTRIES * CORNER_VALUES)
    recs.forEach((rec, entry) =>
      packPageCorners(out, entry * CORNER_VALUES, rec, roots[entry >> 1].world),
    )
    return [...new Uint32Array(out.buffer)]
  }
  const image = () => {
    const dispatches = rt.run.gpuComputeDispatches
    refreshTransparentCorners(rt, device.createCommandEncoder())
    return rt.run.gpuComputeDispatches - dispatches
  }
  const inputs = () =>
    writes
      .splice(0)
      .filter((write) => (write.buffer as { label?: string }).label?.includes('entry inputs'))
      .map(({ offset, size }) => [offset / 64, size! / 16])
  return {
    rt,
    blendState,
    recs,
    roots,
    held,
    oracle,
    image,
    inputs,
    sendWorlds,
    unculled: () => unculled,
  }
}

test('a new age derives every entry; a page bounded elsewhere sends its own entry alone', () => {
  const { blendState, recs, held, oracle, image, inputs, unculled } = runtime()
  assert.equal(image(), 1, 'a new age: one pass over every entry')
  assert.deepEqual(inputs(), [[0, ENTRIES]], 'every entry’s inputs, once')
  assert.equal(unculled(), 1)
  assert.deepEqual(held(), oracle(), 'the corners are the oracle’s, word for word')
  assert.equal(image(), 0, 'nothing moved, no pass')
  assert.deepEqual(inputs(), [])
  Object.assign(recs[2], { moved: { min: [2, 0, 5], max: [3, 1, 6] } })
  Object.assign(blendState.occlusionMoved, { from: 2, to: 2 })
  assert.equal(image(), 1)
  assert.deepEqual(inputs(), [[2, 1]], 'its entry’s inputs alone')
  assert.equal(unculled(), 1, 'the never-culled bits are kept')
  assert.deepEqual(blendState.occlusionMoved, { from: Infinity, to: -1 })
  assert.deepEqual(held(), oracle())
})

test('a moving glass derives its own entries again and sends no input', () => {
  const { rt, roots, held, oracle, image, inputs, sendWorlds } = runtime()
  image()
  inputs()
  const before = held()
  ;(roots[0].world.elements as Float64Array)[12] = 9
  assert.equal(moveRootRows(rt, roots[0], 0), 0, 'no row written')
  assert.equal(rt.blendState.occlusionEpoch, 3, 'the table keeps its age')
  sendWorlds()
  assert.equal(image(), 1, 'one pass')
  assert.deepEqual(inputs(), [], 'no input sent')
  const after = held(),
    split = 2 * CORNER_VALUES
  assert.notDeepEqual(after.slice(0, split), before.slice(0, split), 'its two entries moved')
  assert.deepEqual(after.slice(split), before.slice(split), 'the other glass kept')
  assert.deepEqual(after, oracle())
})

test('before the roots have worlds, the inputs are sent once and every entry waits for them', () => {
  const { rt, held, oracle, image, inputs, unculled } = runtime()
  const worlds = rt.rootWorlds
  ;(rt as { rootWorlds?: unknown }).rootWorlds = undefined
  assert.equal(image(), 0, 'no worlds, no pass')
  assert.deepEqual(inputs(), [[0, ENTRIES]])
  assert.equal(image(), 0)
  assert.deepEqual(inputs(), [], 'the inputs are not sent again each image')
  assert.equal(unculled(), 1)
  ;(rt as { rootWorlds?: unknown }).rootWorlds = worlds
  assert.equal(image(), 1, 'the worlds made: one pass over every entry')
  assert.deepEqual(inputs(), [])
  assert.deepEqual(held(), oracle())
})
