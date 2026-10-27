// The surface cache's card shadows followed through the lighting passes of an image under a sun
// (`lighting/surfaceLighting.ts`): the trace pass is taken instead of the distance field's, the mask
// pass lists traces, the trace pass is dispatched on them, every texel of the listed light tiles ends
// settled, and the box's shadow takes some texels' factor to 0. The lighting's buffers are read
// through a kernel of the proof, from the runtime's state (`cardShadowRead.ts`, `cardAtlasRead.ts`).
//
//   node bench/dawn/proofs.ts tests/gpu/rays/card-shadow-chain.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { runOnDawn } from '../../kit/device/onDawn.ts'
import { animationFrame } from '../../kit/device/frame.ts'
import { settle } from '../world/proofWorld.ts'
import { SUN as BENCH_SUN } from '../../../bench/runner/lighting/lamps.ts'
import { CONTEXT_HEADER_WORDS } from '../../../packages/sdk-browser/src/lighting/surfaceCache/lighting/layout.ts'
import type { CameraPose } from '../../../packages/sdk-core/src/contracts/base.ts'
import { readAtlas } from './cardAtlasRead.ts'
import { readChain } from './cardShadowRead.ts'
import { openTraceWorld, POSE } from './traceWorld.ts'

/** The pose of image `image`: the view moved by a hair, one way and back, so that a held view is not skipped. */
const nudge = (image: number): CameraPose => ({
  ...POSE,
  position: [(image % 2) * 0.002, POSE.position[1], POSE.position[2]],
})

/** The card shadow chain on a held view of the scene under the sun: the images drawn until the surface cache lights its
 *  pages, then images that each begin with the lighting's context emptied from outside, so that what
 *  is read afterwards was written by that image. */
async function measureChain(hardwareRayTracing: boolean) {
  const { world, canvas, runtime } = await openTraceWorld({
    surfaceCacheDirectLightingHardwareRayTracing: hardwareRayTracing,
  })
  try {
    world.addLight(BENCH_SUN)
    world.setPose(POSE)
    await world.awaitPages()
    const settled = (await settle(world, POSE)) !== null
    const rt = runtime()
    if (!rt) throw new Error('the engine built no runtime')
    const device = rt.gpu.device!
    // The cache captures its pages and lights them over its settling images: past them, every listed page holds a capture.
    for (let image = 0; image < 300; image++) {
      await animationFrame()
      world.render(nudge(image))
    }
    let chain = await readChain(rt, device)
    // An image drawn each time, the context emptied before it.
    for (let image = 0; image < 40 && chain.listed === 0; image++) {
      const lighting = rt.surfaceCache?.lighting
      if (lighting?.resources)
        device.queue.writeBuffer(
          lighting.resources.context,
          0,
          new Uint32Array(CONTEXT_HEADER_WORDS),
        )
      if (lighting?.tracedBuffers)
        device.queue.writeBuffer(lighting.tracedBuffers.traces, 0, new Uint32Array(1))
      await animationFrame()
      world.render(nudge(image))
      await world.flush()
      chain = await readChain(rt, device)
    }
    // Whether the lit view settled before the read: a view the chain keeps redrawing is a defect of its own.
    return { ...chain, settled, atlas: await readAtlas(rt, device) }
  } finally {
    world.dispose()
    canvas.remove()
  }
}

const errors: string[] = []

test('the card shadow chain runs end to end: masks listed, traces dispatched, every texel settled, the box shadow found', async () => {
  const chain = await runOnDawn(measureChain, true, errors)
  // The control: the same scene and sun with the shadows from the distance field, whose atlas shows whether the cards were ever captured.
  const control = await runOnDawn(measureChain, false, errors)
  console.log(JSON.stringify({ chain, control }))
  assert.deepEqual(errors, [])
  const state = JSON.stringify(chain)
  assert.ok(chain.listed > 0, `the direct list is empty after the image: ${state}`)
  assert.ok(
    chain.path.tracedBuffers && chain.path.sceneTrace,
    `the traced path was not taken, the distance field's shadows were: ${state}`,
  )
  assert.ok(chain.traces > 0, `the mask pass appended no trace: ${state}`)
  assert.deepEqual(
    chain.dispatch,
    chain.expectedDispatch,
    `the trace pass does not dispatch on the traces: ${state}`,
  )
  assert.equal(
    chain.incomplete,
    0,
    `texels the mask pass left unsettled stay so after the trace pass: ${state}`,
  )
  assert.equal(chain.tracedStillIncomplete, 0, `traced texels still unsettled: ${state}`)
  assert.ok(
    chain.factorZero > 0 && chain.tracedShadowed > 0,
    `no texel is shadowed by a trace, though the sun casts a box shadow: ${state}`,
  )
})
