// A camera that moved over a scene that did not rewrites the translations of the rebased worlds
// alone, and tells the cut so. Oracle: the full rebase at the new eye — every image sends the
// bits it would send — and any doubt (first image, scene change, refused or failed send, new
// buffer) falls back to it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadWorlds } from './worldUpload.ts'
import { rootWorldsToRenderOrigin } from '../../../gpu/dag/pack.ts'
import { random } from '../../../page/cut/cutRuleChecks.fixture.ts'
import type { DagRoot } from '../../../gpu/dag/types.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { EngineCamera } from '../../../camera/world.ts'

type Send = { bits: Uint32Array; posesMoved: boolean; translationsOnly: boolean }

/** An image entry over `count` random roots, whose cut records each send, or answers `reply`. */
function image(count: number, next: () => number) {
  const selectionRoots = Array.from(
    { length: count },
    () =>
      ({
        world: { elements: Float64Array.from({ length: 16 }, () => (next() - 0.5) * 1e5) },
      }) as unknown as DagRoot,
  )
  const sends: Send[] = [],
    control = { reply: (): boolean => true }
  const rt = {
    setup: { worlds: {} },
    layout: { selectionRoots, worldUpdates: new Float32Array(count * 16), rows: { tableEpoch: 1 } },
    timing: { worldCounts: { rootsRebased: 0 } },
    run: {
      gate: { updateWorlds: () => false, revisions: { scene: 3 } },
      worldUploadRevision: 3,
      worldUploadOrigin: new Float64Array([NaN, NaN, NaN]),
      gpuSelection: {
        updateWorlds(worlds: Float32Array, posesMoved: boolean, translationsOnly: boolean) {
          sends.push({
            bits: new Uint32Array(worlds.slice().buffer),
            posesMoved,
            translationsOnly,
          })
          return control.reply()
        },
      },
    },
  } as unknown as WebgpuPagesRuntime
  return { rt, sends, control, selectionRoots }
}

const eye = (x: number, y: number, z: number) => ({ eye: [x, y, z] }) as unknown as EngineCamera

/** Sends one image from `cam`; returns its send, checked bit for bit against a full rebase. */
function send(entry: ReturnType<typeof image>, cam: EngineCamera) {
  const before = entry.sends.length
  uploadWorlds(entry.rt, cam)
  assert.equal(entry.sends.length, before + 1, 'the image sent its worlds')
  const sent = entry.sends[before],
    full = new Float32Array(entry.selectionRoots.length * 16)
  rootWorldsToRenderOrigin(
    full,
    entry.selectionRoots,
    cam.eye,
    new Float64Array(entry.selectionRoots.length * 3),
  )
  assert.deepEqual(sent.bits, new Uint32Array(full.buffer), 'the bits of a full rebase')
  return sent
}

test('a moving eye sends translations alone, bit for bit a full rebase', () => {
  const next = random(918)
  const entry = image(24, next)
  assert.equal(send(entry, eye(0, 0, 0)).translationsOnly, false, 'the first image is whole')
  for (let frame = 0; frame < 50; frame++) {
    const sent = send(entry, eye((next() - 0.5) * 1e6, next() * 1e3, (next() - 0.5) * 1e7))
    assert.equal(sent.translationsOnly, true)
    assert.equal(sent.posesMoved, false)
  }
  for (const edge of [NaN, Infinity, -Infinity, -0, 1e300]) {
    assert.equal(send(entry, eye(edge, 1, -edge)).translationsOnly, true)
    assert.equal(send(entry, eye(2, 3, 4)).translationsOnly, true)
  }
})

test('a scene change, a refused or failed send, or a new buffer sends whole again', () => {
  const next = random(7)
  const entry = image(5, next)
  send(entry, eye(0, 0, 0))
  assert.equal(send(entry, eye(1, 0, 0)).translationsOnly, true)
  // A scene change moved a root: its linear part is read again.
  ;(entry.selectionRoots[2].world.elements as Float64Array)[0] = 3
  ;(entry.rt.run.gate.revisions as { scene: number }).scene++
  const posed = send(entry, eye(2, 0, 0))
  assert.deepEqual([posed.posesMoved, posed.translationsOnly], [true, false])
  assert.equal(send(entry, eye(3, 0, 0)).translationsOnly, true)
  // The cut refused a send: what it holds is unknown, the next one is whole.
  entry.control.reply = () => false
  assert.equal(send(entry, eye(4, 0, 0)).translationsOnly, true)
  entry.control.reply = () => true
  assert.equal(send(entry, eye(5, 0, 0)).translationsOnly, false)
  // The cut threw on a whole send (a non-finite linear part): the next one is whole again.
  entry.control.reply = () => {
    throw new Error('Invalid matrix')
  }
  ;(entry.rt.run.gate.revisions as { scene: number }).scene++
  assert.throws(() => uploadWorlds(entry.rt, eye(6, 0, 0)), /Invalid matrix/)
  entry.control.reply = () => true
  assert.equal(send(entry, eye(7, 0, 0)).translationsOnly, false)
  // A layout rebuilt at the same revision: its buffer never held a whole send.
  entry.rt.layout.worldUpdates = new Float32Array(5 * 16)
  assert.equal(send(entry, eye(8, 0, 0)).translationsOnly, false)
  assert.equal(send(entry, eye(9, 0, 0)).translationsOnly, true)
})

test('an eye that did not move sends nothing', () => {
  const entry = image(3, random(1))
  send(entry, eye(1, 2, 3))
  uploadWorlds(entry.rt, eye(1, 2, 3))
  assert.equal(entry.sends.length, 1)
})
