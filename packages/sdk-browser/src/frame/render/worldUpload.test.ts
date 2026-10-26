// A pose the host wrote moves the scene: with a GPU selection, when its worlds changed; with none —
// a scene with no selection roots — when a root's world differs from the one last sent. The
// occlusion history of the image before is then no longer the scene's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadWorlds } from './worldUpload.ts'
import { noteWorldMoved } from './movedWorlds.ts'
import { createChangedRuns } from '../../geometry/residency/ranges.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** An image entry after a scene change; `walked` says whether the host's write made it. */
function image(walked: boolean, gpuSelection?: { updateWorlds: (...args: never[]) => Int32Array }) {
  // The main view, drawn, and no other: the moves are told to every view's motion (`tellMoved`).
  const main = {}
  return {
    views: { main, active: main, persistent: [] },
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
      rootIndex: { revision: 0 },
    },
    timing: { worldCounts: { rootsUploaded: 0 } },
    blendState: { blendGpu: [], blendIndex: { revision: 0 } },
    lights: { mobility: { cachedDynamic: () => false } },
    run: {
      gate: {
        updateWorlds: () => walked && { reshaped: true, flipped: [] },
        revisions: { scene: 2 },
      },
      worldUploadRevision: 1,
      gpuSelection,
      movedWorlds: createChangedRuns(),
      noOccluderHistory: false,
    },
  } as unknown as WebgpuPagesRuntime
}

test('a host pose that moved a world drops the occluder history, with or without a GPU selection, and only a host pose', () => {
  const bare = image(true)
  assert.equal(uploadWorlds(bare), true)
  assert.equal(bare.run.noOccluderHistory, true, 'a scene with no GPU selection compares by a scan')
  const gpu = image(true, { updateWorlds: () => Int32Array.of(0) })
  uploadWorlds(gpu)
  assert.equal(gpu.run.noOccluderHistory, true, 'the GPU cut too')
  const light = image(true, { updateWorlds: () => new Int32Array(0) })
  uploadWorlds(light)
  assert.equal(light.run.noOccluderHistory, false, 'a GPU cut whose worlds did not change keeps it')
  const engine = image(false)
  uploadWorlds(engine)
  assert.equal(engine.run.noOccluderHistory, false, 'a move the engine made kept its own history')
})

// A light dimmed during a camera flight is a host write that moved no pose: the occlusion history
// must survive it. The worlds are compared as sent, whatever the eye: a write that moved no pose
// keeps the history, at rest as in flight.
for (const kind of ['GPU selection', 'no selection'] as const)
  test(`a host write while the eye moves keeps the history unless a pose moved — ${kind}`, () => {
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
    const { revisions } = rt.run.gate
    /** Whether the upload dropped the history, which it then restores. */
    const dropped = () => {
      uploadWorlds(rt)
      const was = rt.run.noOccluderHistory
      rt.run.noOccluderHistory = false
      return was
    }
    assert.equal(dropped(), true, 'the first upload has nothing to compare with')
    revisions.scene++
    assert.equal(dropped(), false, 'a light written as the eye moves: the poses stand')
    revisions.scene++
    world[13] = 6.5
    assert.equal(dropped(), true, 'a pose written as the eye moves: the history goes')
    revisions.scene++
    assert.equal(dropped(), false, 'the eye at rest, no pose moved: the poses stand')
    revisions.scene++
    world[12] = 4
    assert.equal(dropped(), true, 'the eye at rest, a pose moved: the history goes')
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
  assert.equal(rt.run.noOccluderHistory, false, 'the history stands')
})
