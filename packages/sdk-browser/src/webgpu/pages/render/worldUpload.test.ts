// A pose the host wrote rewrites the table whichever cut draws the image (#428): without the GPU
// cut — the CPU fallback — the rows used to keep their old world.
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
    layout: { selectionRoots: [], worldUpdates: new Float32Array(16), rows: { tableEpoch: 1 } },
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

// #831: a light dimmed during a camera flight is a host write, and the worlds brought back to the
// moving eye all differ from the last ones sent: the cut finds them changed though no pose moved.
// Every row rewritten each image of the flight cost the page table and its row buffers whole.
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
    assert.equal(rows.tableEpoch, 4, 'the eye at rest: the write is weighed as before')
  })
