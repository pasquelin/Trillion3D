// A pose the host wrote rewrites the table whichever cut draws the image: without the GPU
// cut — the CPU fallback — the rows take the new world.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadWorlds } from './worldUpload.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { EngineCamera } from '../../../camera/world.ts'

/** An image entry after a scene change; `walked` says whether the host's write made it. */
function image(walked: boolean, gpuSelection?: { updateWorlds: () => boolean }) {
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
      worldUploadOrigin: new Float64Array(3),
      gpuSelection,
      noOccluderHistory: false,
      temporalHizState: {},
    },
  } as unknown as WebgpuPagesRuntime
}

const cam = { eye: [0, 0, 0] } as unknown as EngineCamera

test('a host pose rewrites every row on the CPU cut as on the GPU cut, and only a host pose', () => {
  const cpu = image(true)
  assert.equal(uploadWorlds(cpu, cam), true)
  assert.equal(cpu.layout.rows.tableEpoch, 2, 'the CPU fallback rewrites the table')
  assert.equal(cpu.run.noOccluderHistory, true)
  const gpu = image(true, { updateWorlds: () => true })
  uploadWorlds(gpu, cam)
  assert.equal(gpu.layout.rows.tableEpoch, 2, 'the GPU cut too')
  const light = image(true, { updateWorlds: () => false })
  uploadWorlds(light, cam)
  assert.equal(light.layout.rows.tableEpoch, 1, 'a GPU cut whose worlds did not change keeps it')
  const engine = image(false)
  uploadWorlds(engine, cam)
  assert.equal(engine.layout.rows.tableEpoch, 1, 'a move the engine made rewrote its own rows')
})

// A light dimmed during a camera flight is a host write that moved no pose: every row rewritten
// each image of the flight cost the page table and its row buffers whole. The worlds are compared
// as sent, whatever the eye: a write that moved no pose keeps the table, at rest as in flight.
for (const cut of ['GPU', 'CPU'] as const)
  test(`a host write while the eye moves keeps the table unless a pose moved — ${cut} cut`, () => {
    const world = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1])
    const rt = image(true, cut === 'GPU' ? { updateWorlds: () => true } : undefined)
    Object.assign(rt.layout, { selectionRoots: [{ world: { elements: world }, pages: [] }] })
    const { revisions } = rt.run.gate,
      rows = rt.layout.rows,
      eye = (x: number) => ({ eye: [x, 2, 3] }) as unknown as EngineCamera
    uploadWorlds(rt, eye(0))
    assert.equal(rows.tableEpoch, 2, 'the first rebase has nothing to compare with')
    revisions.scene++
    uploadWorlds(rt, eye(1))
    assert.equal(rows.tableEpoch, 2, 'a light written as the eye moves: the rows stand')
    revisions.scene++
    world[13] = 6.5
    uploadWorlds(rt, eye(2))
    assert.equal(rows.tableEpoch, 3, 'a pose written as the eye moves: every row again')
    revisions.scene++
    uploadWorlds(rt, eye(2))
    assert.equal(rows.tableEpoch, 3, 'the eye at rest, no pose moved: the rows stand')
    revisions.scene++
    world[12] = 4
    uploadWorlds(rt, eye(2))
    assert.equal(rows.tableEpoch, 4, 'the eye at rest, a pose moved: every row again')
  })
