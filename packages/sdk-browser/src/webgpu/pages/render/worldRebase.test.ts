// A camera that moves over a still scene sends nothing: the cut's worlds are brought to
// the eye on the GPU (`../../../gpu/dag/worldRebase.ts`), at the eye this image names
// (`worldUploadOrigin`). A scene change sends every root's world in single precision, whatever the
// eye — the bits `rootWorlds` writes —, and a cut that throws on them is not hidden.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadWorlds } from './worldUpload.ts'
import { rootWorlds } from '../../../gpu/dag/pack.ts'
import { random } from '../../../page/cut/cutRuleChecks.fixture.ts'
import type { DagRoot } from '../../../gpu/dag/types.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { EngineCamera } from '../../../camera/world.ts'

/** An image entry over `count` random roots, whose cut records each send, or answers `reply`. */
function image(count: number, next: () => number) {
  const selectionRoots = Array.from(
    { length: count },
    () =>
      ({
        world: { elements: Float64Array.from({ length: 16 }, () => (next() - 0.5) * 1e5) },
      }) as unknown as DagRoot,
  )
  const sends: Uint32Array[] = [],
    control = { reply: (): boolean => true }
  const rt = {
    setup: { worlds: {} },
    layout: { selectionRoots, worldUpdates: new Float32Array(count * 16), rows: { tableEpoch: 1 } },
    timing: { worldCounts: { rootsRebased: 0 } },
    run: {
      gate: { updateWorlds: () => false, revisions: { scene: 3 } },
      worldUploadRevision: 2,
      worldUploadOrigin: new Float64Array([NaN, NaN, NaN]),
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

const eye = (x: number, y: number, z: number) => ({ eye: [x, y, z] }) as unknown as EngineCamera

test('a moving eye over a still scene sends nothing, and names the eye the GPU brings worlds to', () => {
  const next = random(918)
  const entry = image(24, next)
  uploadWorlds(entry.rt, eye(0, 0, 0))
  assert.equal(entry.sends.length, 1, 'the first image sends the worlds')
  const whole = new Float32Array(24 * 16)
  rootWorlds(whole, entry.selectionRoots)
  assert.deepEqual(entry.sends[0], new Uint32Array(whole.buffer), 'each world in single precision')
  for (let frame = 0; frame < 50; frame++) {
    const at = eye((next() - 0.5) * 1e6, next() * 1e3, (next() - 0.5) * 1e7)
    uploadWorlds(entry.rt, at)
    assert.deepEqual([...entry.rt.run.worldUploadOrigin], at.eye)
  }
  assert.equal(entry.sends.length, 1, 'no send while the scene holds still')
})

test('a scene change sends every world again, whatever the eye; a throwing cut is not hidden', () => {
  const next = random(7)
  const entry = image(5, next)
  uploadWorlds(entry.rt, eye(0, 0, 0))
  ;(entry.selectionRoots[2].world.elements as Float64Array)[0] = 3
  ;(entry.rt.run.gate.revisions as { scene: number }).scene++
  uploadWorlds(entry.rt, eye(2, 0, 0))
  assert.equal(entry.sends.length, 2)
  assert.equal(new Float32Array(entry.sends[1].buffer)[32], 3)
  entry.control.reply = () => {
    throw new Error('Invalid matrix')
  }
  ;(entry.rt.run.gate.revisions as { scene: number }).scene++
  assert.throws(() => uploadWorlds(entry.rt, eye(6, 0, 0)), /Invalid matrix/)
})
