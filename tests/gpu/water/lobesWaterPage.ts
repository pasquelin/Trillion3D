// The engine side of the transmissive lobes proof (`lobes.gpu.ts`): the plane of the opaque lobes
// proofs (`../visibility/physicalLobesPage.ts`), transmissive — drawn by the water pass, its lobed
// surface stage leaving the fragment's lobes in the lobes target, its composite lighting them
// (`packages/sdk-browser/src/webgpu/water/lobesWgsl.ts`) —, rendered by the real WebGPU engine until
// held, on a device that grants the lobed stage its attachments.
import type * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { colorBytesPerSample } from '../../../packages/sdk-browser/src/gpu/core/colorBytes.fixture.ts'
import { waterSurfaceTargets } from '../../../packages/sdk-browser/src/webgpu/water/surfaceTargets.ts'
import {
  WATER_COMPOSITE_PASS,
  WATER_SURFACE_PASS,
} from '../../../packages/sdk-browser/src/webgpu/water/passLabels.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import {
  ANISOTROPY_CASES,
  CLEARCOAT_CASES,
  readCases,
  type LobeReading,
} from '../visibility/physicalLobesPage.ts'

/** The colour bytes per sample the lobed surface stage writes: the lobes target beside the others. */
const LOBED_ATTACHMENT_BYTES = colorBytesPerSample(
  waterSurfaceTargets(true, true).map((target) => target.format),
)

/** Each case's plane, transmitting `transmission` of what lies behind it (nothing: the lamp's
 *  highlight and the lit share carry the image), read as the opaque proofs read theirs. A case
 *  that did not encode the water's two passes is no proof of them. */
const transmitted = (transmission: number, cases: Record<string, G.SurfaceParameters>) =>
  runOnDevice<{ readings: Record<string, LobeReading> }>(
    async (device, events, result) => {
      const labels = new Set<string>()
      const create = device.createCommandEncoder.bind(device)
      device.createCommandEncoder = (descriptor) => {
        const encoder = create(descriptor),
          begin = encoder.beginRenderPass.bind(encoder)
        encoder.beginRenderPass = (pass) => (labels.add(pass.label ?? ''), begin(pass))
        return encoder
      }
      try {
        await readCases(device, events, result, cases, {
          blend: true,
          // A still view that never holds names why its frames were drawn (`frame-drawn`).
          trace: true,
          shown: (surface) => ({ ...surface, transmission, ior: 1.5, thickness: 0.1 }),
          after: (name) => {
            if (!labels.has(WATER_SURFACE_PASS) || !labels.has(WATER_COMPOSITE_PASS))
              throw new Error(`${name} did not draw through the water pass`)
            labels.clear()
          },
        })
      } finally {
        device.createCommandEncoder = create
      }
    },
    { maxColorAttachmentBytesPerSample: LOBED_ATTACHMENT_BYTES },
  )

/** The clear coat over a transmissive matte base: none, a sharp coat, and a coat its map zeroes. */
export const clearcoat = () => transmitted(0.5, CLEARCOAT_CASES)

/** The anisotropic lobe of a transmissive metal: none, along the tangent, turned a quarter, and a
 *  strength map at zero. */
export const anisotropy = () => transmitted(0.25, ANISOTROPY_CASES)
