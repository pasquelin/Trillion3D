// A pose the host wrote rewrites the table: with a GPU selection, when its worlds changed; with
// none — a scene with no selection roots — the rows take the new world.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadWorlds } from './worldUpload.ts'
import { noteWorldMoved } from './movedWorlds.ts'
import { createSortedKeys } from '../../cut/denseKeys.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** An image entry after a scene change; `walked` says whether the host's write made it. */
function image(walked: boolean, gpuSelection?: { updateWorlds: (...args: never[]) => Int32Array }) {
  return {
    setup: { worlds: {} },
    // No deformation: a host walk has no staleness to forget (`deformation/frame.ts`).
    vis: {},
    // One root, posed where the worlds held say nothing yet: the host's write moved it.
    layout: {
      selectionRoots: [
        { world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 9, 0, 0, 1] }, pages: [] },
      ],
      worldUpdates: new Float32Array(16),
      worldsScanned: new Int32Array(1),
      rows: { tableEpoch: 1 },
    },
    timing: { worldCounts: { rootsUploaded: 0 } },
    blendState: { blendGpu: [] },
    lights: { mobility: { moves: () => false } },
    run: {
      gate: { updateWorlds: () => walked, revisions: { scene: 2 } },
      worldUploadRevision: 1,
      gpuSelection,
      movedWorlds: createSortedKeys(),
      noOccluderHistory: false,
    },
  } as unknown as WebgpuPagesRuntime
}

test('a host pose rewrites every row, with or without a GPU selection, and only a host pose', () => {
  const bare = image(true)
  assert.equal(uploadWorlds(bare), true)
  assert.equal(bare.layout.rows.tableEpoch, 2, 'a scene with no GPU selection rewrites the table')
  assert.equal(bare.run.noOccluderHistory, true)
  const gpu = image(true, { updateWorlds: () => Int32Array.of(0) })
  uploadWorlds(gpu)
  assert.equal(gpu.layout.rows.tableEpoch, 2, 'the GPU cut too')
  const light = image(true, { updateWorlds: () => new Int32Array(0) })
  uploadWorlds(light)
  assert.equal(light.layout.rows.tableEpoch, 1, 'a GPU cut whose worlds did not change keeps it')
  const engine = image(false)
  uploadWorlds(engine)
  assert.equal(engine.layout.rows.tableEpoch, 1, 'a move the engine made rewrote its own rows')
})

// A light dimmed during a camera flight is a host write that moved no pose: every row rewritten
// each image of the flight cost the page table and its row buffers whole. The worlds are compared
// as sent, whatever the eye: a write that moved no pose keeps the table, at rest as in flight.
for (const kind of ['GPU selection', 'no selection'] as const)
  test(`a host write while the eye moves keeps the table unless a pose moved — ${kind}`, () => {
    const world = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1])
    // The cut answers which of the worlds it holds moved, as `updateWorlds` does.
    const held = new Float32Array(16).fill(NaN)
    const cut = {
      updateWorlds: (worlds: Float32Array) => {
        const moved = worlds.some((value, k) => value !== held[k])
        held.set(worlds)
        return moved ? Int32Array.of(0) : new Int32Array(0)
      },
    }
    const rt = image(true, kind === 'GPU selection' ? (cut as never) : undefined)
    Object.assign(rt.layout, { selectionRoots: [{ world: { elements: world }, pages: [] }] })
    const { revisions } = rt.run.gate,
      rows = rt.layout.rows
    uploadWorlds(rt)
    assert.equal(rows.tableEpoch, 2, 'the first upload has nothing to compare with')
    revisions.scene++
    uploadWorlds(rt)
    assert.equal(rows.tableEpoch, 2, 'a light written as the eye moves: the rows stand')
    revisions.scene++
    world[13] = 6.5
    uploadWorlds(rt)
    assert.equal(rows.tableEpoch, 3, 'a pose written as the eye moves: every row again')
    revisions.scene++
    uploadWorlds(rt)
    assert.equal(rows.tableEpoch, 3, 'the eye at rest, no pose moved: the rows stand')
    revisions.scene++
    world[12] = 4
    uploadWorlds(rt)
    assert.equal(rows.tableEpoch, 4, 'the eye at rest, a pose moved: every row again')
  })

test('a pose a call named sends its world alone, every other left as the cut holds it', () => {
  const calls: [Float32Array, Int32Array][] = []
  const rt = image(false, {
    updateWorlds: (...args: never[]) => (calls.push(args as never), Int32Array.of(1)),
  })
  const at = (x: number) => ({
    world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1] },
  })
  Object.assign(rt.layout, {
    selectionRoots: [at(1), at(2), at(3)],
    worldUpdates: new Float32Array(48),
  })
  noteWorldMoved(rt.run, 1)
  uploadWorlds(rt)
  const [[worlds, named]] = calls
  assert.deepEqual([...named], [1], 'the one named placement')
  assert.equal(worlds[1 * 16 + 12], 2, 'its world taken')
  assert.equal(worlds[0 * 16 + 12] + worlds[2 * 16 + 12], 0, 'no other read')
  assert.equal(rt.layout.rows.tableEpoch, 1, 'the table stands')
})

test('a host walk hands the impostor cards the poses its send moved, never every root', () => {
  const told: number[][] = []
  const rt = image(true, { updateWorlds: () => Int32Array.of(2) })
  const at = (x: number) => ({
    world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1] },
    pages: [],
  })
  Object.assign(rt.layout, {
    selectionRoots: [at(1), at(2), at(3)],
    worldUpdates: new Float32Array(48),
  })
  Object.assign(rt, {
    gpu: { impostors: { worldsMoved: (ranks: Int32Array) => told.push([...ranks]) } },
  })
  uploadWorlds(rt)
  assert.deepEqual(told, [[2]], 'the one the cut says moved')
})
