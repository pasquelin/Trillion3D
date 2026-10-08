// Page side of the capture readback proof: an image copied back by the engine's one readback
// (`readGpuImage`) at a width whose rows the copy pads, compared byte for byte, bottom row first;
// then the engine's capture of a frame no flush settled against the capture its flush settled.
import { readGpuImage } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { cameraFace, engine, release } from '../kit/sharedSceneProof.ts'
import { difference, redCount, untilHeld } from '../kit/sceneImageProof.ts'
import { animationFrame } from '../kit/frame.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { flipRows, gaps, writePattern } from '../kit/patternImage.ts'
import { transformScene } from '../placement/transformScene.ts'

/** A pattern no flip, transposition or offset leaves looking the same, at row `y`, column `x`. */
const pattern = (x: number, y: number) => [(x * 4) & 255, (y * 50) & 255, (x + y) & 255, 255]

/** The pattern written at 67 × 5 — a row of 268 bytes, padded to 512 by the copy — and read back
 *  bottom row first; written at its level 1, 33 × 2, and read back from that level top row first.
 *  Each read: the bytes read and how many texels differ from the pattern. */
async function paddedRead(device: GPUDevice) {
  const texture = device.createTexture({
    size: [67, 5],
    format: 'rgba8unorm',
    mipLevelCount: 2,
    usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  })
  const read = async (mipLevel: number, topDown: boolean) => {
    const width = 67 >> mipLevel,
      height = 5 >> mipLevel
    const bytes = writePattern(device, texture, [width, height], pattern, mipLevel)
    const got = await readGpuImage(device, texture, width, height, undefined, {
      mipLevel,
      topDown,
    })
    return {
      bytes: got.length,
      different: gaps(got, topDown ? bytes : flipRows(bytes, width)).texels,
    }
  }
  const whole = await read(0, false),
    level = await read(1, true)
  texture.destroy()
  return { ...whole, level }
}

/** The engine's view held, then slid: its capture read before any flush, then after the flush. */
async function sequence(
  device: GPUDevice,
  events: unknown[],
  result: { padded?: unknown; scene?: unknown },
) {
  result.padded = await paddedRead(device)
  const scene = transformScene(false)
  const { backend, canvas } = engine(scene, device, (e) => events.push(e))
  try {
    await backend.prepare()
    const held = await untilHeld(backend, cameraFace())
    // A new image, submitted and never flushed: the capture copies it back itself.
    const slid = cameraFace(0.2)
    await animationFrame()
    backend.render(slid)
    const unsettled = await backend.capture()
    await backend.flush()
    const settled = await backend.capture()
    result.scene = {
      held: held.held !== null,
      red: redCount(unsettled),
      bytes: unsettled.length,
      moved: held.held ? difference(held.held, unsettled) : null,
      difference: difference(settled, unsettled),
    }
  } finally {
    release(backend, canvas, scene)
  }
}

export function runCaptureReadback() {
  return runOnDevice<{ padded: unknown; scene: unknown }>(sequence)
}
