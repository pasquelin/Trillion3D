// A moved host rig, a still scene and an unchanged cut: the projected bounds the Hi-Z test reads
// are the new view's. They are screen rectangles the GPU partition computes each frame from the
// view matrices the CPU sends; under a rig the camera has no new local pose, and without resolving
// the ancestor chain those matrices would be the previous view's. Each pose's moved image, and the
// still image after it — drawn, not held, so drawn from the same matrices rather than copied —,
// match a fresh engine placed at the same world pose, byte for byte (`rigCameraPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../kit/enginePageProof.ts'

type Reading = Awaited<ReturnType<typeof import('./rigCameraPage.ts').runRigCamera>>

test('under a moved rig, the Hi-Z test reads the new view’s rectangles', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'rigCameraPage.ts'),
    'hizRig',
    'runRigCamera',
  )) as Reading
  console.log(JSON.stringify({ adapter: reading.adapter, steps: reading.steps }))
  assertSoundProof(reading)
  const { steps } = reading
  assert.ok(steps.length >= 4, 'several rig poses')
  for (const { x, clusters, rowsMoved, rowsStill, stillHeld, gapMoved, gapStill } of steps) {
    assert.equal(clusters, steps[0].clusters, `at ${x}, the cut changed: the proof needs the same`)
    assert.equal(gapMoved, 0, `at ${x}, the moved image differs from the witness: old rectangles`)
    // A held frame encodes and counts nothing: it would bypass the rig resolution, not prove it.
    assert.ok((rowsMoved ?? 0) > 0 && rowsStill === rowsMoved, `at ${x}, the rows differ`)
    assert.equal(stillHeld, false, `at ${x}, the still frame was held`)
    assert.equal(gapStill, 0, `at ${x}, the still image differs from the witness: old matrices`)
  }
  // Without an occlusion flip along the poses, matching the witness would prove nothing.
  const slab = steps.map((step) => step.slab)
  assert.equal(Math.min(...slab), 0, 'the slab is never occluded: the Hi-Z test decides nothing')
  assert.ok(Math.max(...slab) > 0, 'the slab is never visible: the Hi-Z test decides nothing')
})
