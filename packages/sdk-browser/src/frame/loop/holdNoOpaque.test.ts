// The occluder history is established by an image that draws opaque rows alone: the pyramid it
// leaves is what the next image's cut occlusion reads. A view with none — blend clusters alone, the
// sky — must neither clear the bit nor hold its frame on it. It does not count there, and counts as
// soon as an opaque page is packed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unsettledMask, unsettledReasons } from './unsettled.ts'
import { HOLD_WITHIN, settledRt } from './hold.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { camera, flushedGpuScene, quadScene } from '../backend/testScenes.fixture.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'

test('a view without a packed opaque page owes no occluder history', () => {
  const rt = settledRt()
  rt.run.noOccluderHistory = true
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['noOccluderHistory'])
  rt.layout.packedPages.length = 0
  assert.equal(unsettledMask(rt), 0, 'no opaque page: the frame may be held')
  rt.layout.packedPages.push({})
  assert.deepEqual(
    unsettledReasons(unsettledMask(rt)),
    ['noOccluderHistory'],
    'the missing history still waits for the first packed page',
  )
})

/** Renders the still view as a host does, frame after frame; the index of the first held one. A
 *  few frames to settle the cut. */
async function firstHeld(backend: Awaited<ReturnType<typeof flushedGpuScene>>['backend']) {
  for (let frame = 0; frame < HOLD_WITHIN; frame++) {
    backend.render(camera())
    await backend.flush()
    if (backend.metrics().frameHeld) return frame
  }
  return -1
}

test('a still view of blend clusters alone holds its frame, and a moved one redraws', async () => {
  installGpuGlobals()
  const scene = quadScene()
  scene.metadata.primitives[0].pass = 'clustered-blend'
  scene.material.transparent = true
  scene.material.opacity = 0.5
  // A view whose temporal pass runs draws every frame (`taaRuns`): the hold is the plain view's.
  const { backend } = await flushedGpuScene(scene, { temporalAntialiasing: false })
  try {
    assert.notEqual(await firstHeld(backend), -1, 'the still blend-only view is held')
    scene.source.children[0].position.x = 0.25
    scene.source.updateMatrixWorld(true)
    backend.render(camera())
    assert.equal(backend.metrics().frameHeld, false, 'a moved blend surface is drawn again')
  } finally {
    backend.dispose()
    scene.geometry.dispose()
    scene.material.dispose()
  }
})

test('a still view of a translucent surface whose graph reads the time is drawn every image, not held', async () => {
  installGpuGlobals()
  const scene = quadScene()
  scene.metadata.primitives[0].pass = 'clustered-blend'
  const graph = material.graph('surface')
  graph.output('emissive', graph.constant(1, 0, 0))
  graph.output('opacity', graph.multiply(graph.sine(graph.time(), 2), 0.5))
  Object.assign(scene.material, { transparent: true, opacity: 0.5, graph })
  const { backend } = await flushedGpuScene(scene, { temporalAntialiasing: false })
  try {
    for (let frame = 0; frame < 8; frame++) {
      backend.render(camera())
      await backend.flush()
      assert.equal(backend.metrics().frameHeld, false, `image ${frame} is drawn`)
    }
  } finally {
    backend.dispose()
    scene.geometry.dispose()
    scene.material.dispose()
  }
})
