// A pose the host wrote rewrites the table: with a GPU selection, when its worlds changed; with
// none — a scene with no selection roots — the rows take the new world.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadWorlds } from './worldUpload.ts'
import { createMovedWorlds, noteWorldMoved } from './movedWorlds.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** An image entry after a scene change; `walked` says whether the host's write made it. */
function image(walked: boolean, gpuSelection?: { updateWorlds: (...args: never[]) => boolean }) {
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
      rows: { tableEpoch: 1 },
    },
    timing: { worldCounts: { rootsRebased: 0 } },
    blendState: { blendGpu: [] },
    lights: { mobility: { moves: () => false } },
    run: {
      gate: { updateWorlds: () => walked, revisions: { scene: 2 } },
      worldUploadRevision: 1,
      gpuSelection,
      movedWorlds: createMovedWorlds(),
      noOccluderHistory: false,
    },
  } as unknown as WebgpuPagesRuntime
}

test('a host pose rewrites every row, with or without a GPU selection, and only a host pose', () => {
  const bare = image(true)
  assert.equal(uploadWorlds(bare), true)
  assert.equal(bare.layout.rows.tableEpoch, 2, 'a scene with no GPU selection rewrites the table')
  assert.equal(bare.run.noOccluderHistory, true)
  const gpu = image(true, { updateWorlds: () => true })
  uploadWorlds(gpu)
  assert.equal(gpu.layout.rows.tableEpoch, 2, 'the GPU cut too')
  const light = image(true, { updateWorlds: () => false })
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
    const rt = image(true, kind === 'GPU selection' ? { updateWorlds: () => true } : undefined)
    Object.assign(rt.layout, { selectionRoots: [{ world: { elements: world }, pages: [] }] })
    const { revisions } = rt.run.gate,
      rows = rt.layout.rows
    uploadWorlds(rt)
    assert.equal(rows.tableEpoch, 2, 'the first rebase has nothing to compare with')
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
    updateWorlds: (...args: never[]) => (calls.push(args as never), true),
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
