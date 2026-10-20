// Page of the water-pass proof: the real WebGPU engine (`webgpuPagesEngine`), a real device, a
// real reread image. A transmissive tile in front of an opaque ground, or of nothing, rendered
// through the water pass and read at its centre; the encoded pass labels prove the intended path.
import * as G from '../../../packages/sdk-browser/src/scene/host/graph/graph.fixture.ts'
import { Color } from '../../../packages/sdk-core/src/world/math/color.ts'
import {
  VIEWPORT,
  batisseur,
  cameraFace,
  engine,
  release,
  type ScenePreparee,
} from '../../kit/device/sharedSceneProof.ts'
import { image } from '../../kit/device/sceneImageProof.ts'
import { REFLECTION_COUNTS } from '../../../packages/sdk-browser/src/lighting/reflections/constants.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'
import { recordPassLabels, runOnDevice } from '../../kit/device/deviceProof.ts'
import {
  BACKGROUND,
  CASES,
  GROUND,
  WATER_ATTACHMENT_BYTES,
  waterSurface,
  type WaterCase,
} from './waterPassCases.ts'
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/diagnostic/types.ts'
import { DISTORTION_PASS } from '../../../packages/sdk-browser/src/diagnostic/stage/passLabels.ts'

function scene(kase: WaterCase): ScenePreparee {
  const builder = batisseur()
  const ground = G.basicSurface({ color: new Color(GROUND.color), side: G.DOUBLE_SIDE })
  builder.place(ground, 'exact-clusters', 4, [kase.groundX, 0, -GROUND.depth]).name = 'ground'
  const water = waterSurface(kase.transmission, kase.thickness)
  builder.place(water, 'clustered-blend', 1).name = 'water'
  return builder.fini()
}

/** RGB read at the tile's centre. Bottom-left origin, like `capture`. */
function centre(pixels: Uint8Array): number[] {
  const [w, h] = VIEWPORT,
    i = ((h >> 1) * w + (w >> 1)) * 4
  return [pixels[i], pixels[i + 1], pixels[i + 2]]
}

interface CaseResult {
  name: string
  centre: number[]
  moved: number[]
  drawsFirst: number | null | undefined
  drawsLast: number | null | undefined
  heldLast: boolean | null | undefined
}

/** One case: four frames of the same pose, then on until one is held. The centre of the first, the
 *  draws, whether the first four moved, and whether the last was held — a still scene must end with no
 *  work at all. */
async function waterCase(
  device: GPUDevice,
  kase: WaterCase,
  events: EngineDiagnostic[],
): Promise<CaseResult> {
  const { labels, restore } = recordPassLabels(device)
  const s = scene(kase)
  const { backend, canvas } = engine(s, device, (e: EngineDiagnostic) => events.push(e), {
    clearColor: BACKGROUND,
  })
  try {
    await backend.prepare()
    const camera = cameraFace()
    const frames: {
      centre: number[]
      draws: number | null | undefined
      held: boolean | null | undefined
      moved: number
      pixels: Uint8Array
    }[] = []
    // Four images of the pose, then a fixed count more: the reflections' history full twice over
    // (`REFLECTION_HISTORY`).
    for (let i = 0; i < 4 + 2 * REFLECTION_COUNTS.REFLECTION_HISTORY; i++) {
      const { pixels, metrics: metrics } = await image(backend, camera)
      frames.push({
        centre: centre(pixels),
        draws: metrics.transparentDrawCalls,
        held: metrics.frameHeld,
        moved: frames.length
          ? compareImages(frames[frames.length - 1].pixels, pixels).differentPixels
          : 0,
        pixels,
      })
    }
    if (kase.transmission > 0 && !labels.has(DISTORTION_PASS))
      throw new Error('Water proof did not encode the distortion of its transmissive layer')
    return {
      name: kase.name,
      centre: frames[0].centre,
      moved: frames.slice(0, 4).map((f) => f.moved),
      drawsFirst: frames[0].draws,
      drawsLast: frames[frames.length - 1].draws,
      heldLast: frames[frames.length - 1].held,
    }
  } finally {
    restore()
    release(backend, canvas, s)
  }
}

/** Every case, on a device that grants the water stage its attachments. */
export function run() {
  return runOnDevice<{ cases: CaseResult[] }>(
    async (device, events, result) => {
      const cases: CaseResult[] = (result.cases = [])
      for (const kase of CASES)
        cases.push(await waterCase(device, kase, events as EngineDiagnostic[]))
    },
    { maxColorAttachmentBytesPerSample: WATER_ATTACHMENT_BYTES },
  )
}
