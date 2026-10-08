// A camera that moves over a still scene sends nothing: each cut reads its translations at its own
// eye (`../../../gpu/dag/shader/worldPoseWgsl.ts`). The host's walk sends every root's world in
// single precision — the bits `rootWorlds` writes —, a pose a call named sends its own, and a cut
// that throws on them is not hidden.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadWorlds } from './worldUpload.ts'
import { noteWorldMoved } from './movedWorlds.ts'
import { createSortedKeys } from '../../cut/denseKeys.ts'
import { rootWorlds } from '../../../gpu/dag/pack.ts'
import { random } from '../../../page/cut/cutRuleChecks.fixture.ts'
import type { DagRoot } from '../../../gpu/dag/types.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** An image entry over `count` random roots, whose cut records each send, or answers `reply`. */
function image(count: number, next: () => number) {
  const selectionRoots = Array.from(
    { length: count },
    () =>
      ({
        world: { elements: Float64Array.from({ length: 16 }, () => (next() - 0.5) * 1e5) },
        pages: [],
      }) as unknown as DagRoot,
  )
  const sends: Uint32Array[] = [],
    control = { reply: (): boolean => true },
    walks = [true]
  const rt = {
    setup: { worlds: {} },
    // A host walk with no deformation and nothing hidden or shown (`worldUpload.test.ts`).
    vis: {},
    blendState: { blendGpu: [] },
    lights: { mobility: { moves: () => false } },
    layout: { selectionRoots, worldUpdates: new Float32Array(count * 16), rows: { tableEpoch: 1 } },
    timing: { worldCounts: { rootsUploaded: 0 } },
    run: {
      gate: { updateWorlds: () => walks.shift() ?? false, revisions: { scene: 3 } },
      movedWorlds: createSortedKeys(),
      worldUploadRevision: 2,
      gpuSelection: {
        updateWorlds(worlds: Float32Array) {
          sends.push(new Uint32Array(worlds.slice().buffer))
          return control.reply()
        },
      },
    },
  } as unknown as WebgpuPagesRuntime
  return { rt, sends, control, selectionRoots }
}

test('a moving eye over a still scene sends nothing', () => {
  const next = random(918)
  const entry = image(24, next)
  uploadWorlds(entry.rt)
  assert.equal(entry.sends.length, 1, "the host's first walk sends the worlds")
  const whole = new Float32Array(24 * 16)
  rootWorlds(whole, entry.selectionRoots)
  assert.deepEqual(entry.sends[0], new Uint32Array(whole.buffer), 'each world in single precision')
  for (let frame = 0; frame < 50; frame++) uploadWorlds(entry.rt)
  assert.equal(entry.sends.length, 1, 'no send while the scene holds still')
})

test('a named pose sends its world again; a throwing cut is not hidden', () => {
  const next = random(7)
  const entry = image(5, next)
  uploadWorlds(entry.rt)
  ;(entry.selectionRoots[2].world.elements as Float64Array)[0] = 3
  noteWorldMoved(entry.rt.run, 2)
  ;(entry.rt.run.gate.revisions as { scene: number }).scene++
  uploadWorlds(entry.rt)
  assert.equal(entry.sends.length, 2)
  assert.equal(new Float32Array(entry.sends[1].buffer)[32], 3)
  entry.control.reply = () => {
    throw new Error('Invalid matrix')
  }
  noteWorldMoved(entry.rt.run, 2)
  ;(entry.rt.run.gate.revisions as { scene: number }).scene++
  assert.throws(() => uploadWorlds(entry.rt), /Invalid matrix/)
})
