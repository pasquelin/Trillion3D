// A held WebGPU frame shows the composed image unchanged (`facingWorld.ts`, the `three-stack`
// golden): unlit, then lit by the bench sun — the display chain's filmic curve then applies —, the
// image is settled, then three held frames in a row follow. What the canvas holds is the display
// image byte for byte (`capture()`, the engine's readback of it): presenting it neither encodes nor
// tone-maps it a second time. And each held frame leaves both the canvas and the capture as the
// complete frame left them: a held frame draws nothing of the scene and puts back nothing else.
//
//   node bench/dawn/proofs.ts tests/gpu/frame/held-frame-colour.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { animationFrame, runOnDawn } from '../kit/onDawn.ts'
import { canvasImage } from '../kit/patternImage.ts'
import { difference } from '../kit/sceneImageProof.ts'
import { settle } from '../world/proofWorld.ts'
import { FACING, openFacingWorld } from './facingWorld.ts'

/** One case: the settled frame's canvas and capture, then each held frame's, and whether each
 *  of those frames was held. */
async function heldCase(world: Awaited<ReturnType<typeof openFacingWorld>>, lit: boolean) {
  if (lit) world.addLight(SUN)
  const settled = (await settle(world, FACING)) !== null
  const complete = {
    canvas: await canvasImage(world),
    capture: new Uint8Array(await world.capture()),
  }
  const held = []
  for (let i = 0; i < 3; i++) {
    await animationFrame()
    const { frameHeld } = world.render(FACING)
    await world.flush()
    held.push({
      frameHeld: frameHeld === true,
      canvas: await canvasImage(world),
      capture: new Uint8Array(await world.capture()),
    })
  }
  return { lit, settled, complete, held }
}

async function cases() {
  const world = await openFacingWorld('three-stack')
  try {
    const unlit = await heldCase(world, false)
    return [unlit, await heldCase(world, true)]
  } finally {
    world.dispose()
  }
}

/** Distinct RGBA values of an image: one value only would hide a re-encode. */
const values = (image: Uint8Array) => {
  const seen = new Set<number>()
  for (let i = 0; i < image.length; i += 4)
    seen.add(((image[i] << 16) | (image[i + 1] << 8) | image[i + 2]) * 256 + image[i + 3])
  return seen.size
}

test('a held WebGPU frame shows the composed image unchanged, lit and unlit', async () => {
  const errors: string[] = []
  const read = await runOnDawn(cases, null, errors)
  assert.deepEqual(errors, [])
  for (const { lit, settled, complete, held } of read) {
    const name = lit ? 'lit' : 'unlit'
    console.log(
      JSON.stringify({
        name,
        settled,
        values: values(complete.capture),
        presented: difference(complete.canvas, complete.capture),
        held: held.map((frame) => [
          frame.frameHeld,
          difference(frame.canvas, complete.canvas),
          difference(frame.capture, complete.capture),
        ]),
      }),
    )
    assert.ok(settled, `${name}: the image never settled`)
    assert.ok(values(complete.capture) > 2, `${name}: the image holds too few values to prove it`)
    assert.equal(
      difference(complete.canvas, complete.capture),
      0,
      `${name}: the canvas does not hold the display image byte for byte`,
    )
    for (const [rank, frame] of held.entries()) {
      assert.ok(frame.frameHeld, `${name}: frame ${rank} after the settled one was not held`)
      assert.equal(difference(frame.canvas, complete.canvas), 0, `${name}: held canvas ${rank}`)
      assert.equal(difference(frame.capture, complete.capture), 0, `${name}: held capture ${rank}`)
    }
  }
})
