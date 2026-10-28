// A moved host rig, a still scene and an unchanged cut: the projected bounds the occlusion test
// reads are the new view's. They are screen rectangles the cut computes each frame from the view
// matrices the CPU sends; under a rig the camera has no new local pose, and without resolving the
// ancestor chain those matrices would be the previous view's. Each pose's moved image, and the
// still image after it — drawn, not held, so drawn from the same matrices rather than copied —,
// match a fresh engine placed at the same world pose, byte for byte (`rigCameraPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof } from '../../kit/device/enginePageProof.ts'

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
  for (const {
    x,
    clusters,
    clustersStill,
    drawsMoved,
    drawsStill,
    stillHeld,
    gapMoved,
    gapStill,
  } of steps) {
    // The clusters drawn are the cut's AFTER the occlusion (`FrameMetrics.clusters`): a slab behind the
    // wall is held back and hidden for good, so the count follows the pose by design — the proof below
    // needs the slab to flip. What the pose alone decides is the same for the moved image, whose
    // previous pyramid is another pose's, and the still image, whose pyramid is its own: the post
    // pass corrects the first by the second.
    assert.equal(
      clusters,
      clustersStill,
      `at ${x}, the moved image drew another cut than the still one`,
    )
    assert.equal(gapMoved, 0, `at ${x}, the moved image differs from the witness: old rectangles`)
    // A held frame encodes and counts nothing: it would bypass the rig resolution, not prove it.
    assert.ok((drawsMoved ?? 0) > 0 && drawsStill === drawsMoved, `at ${x}, the draws differ`)
    assert.equal(stillHeld, false, `at ${x}, the still frame was held`)
    assert.equal(gapStill, 0, `at ${x}, the still image differs from the witness: old matrices`)
  }
  // Without an occlusion flip along the poses, matching the witness would prove nothing.
  const slab = steps.map((step) => step.slab)
  assert.equal(Math.min(...slab), 0, 'the slab is never occluded: the Hi-Z test decides nothing')
  assert.ok(Math.max(...slab) > 0, 'the slab is never visible: the Hi-Z test decides nothing')
})
