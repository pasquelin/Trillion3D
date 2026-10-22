import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { rewritesSurfaces, type ViewOverrides } from '../backend/state/viewOverrides.ts'
import { encodeSurfaceRewrite } from '../../lighting/deferred/surfaceOverride.ts'
import { finishVsmFrame } from '../../lighting/shadows/vsm/frame/vsmFrameEnd.ts'
import { adoptRadianceImage } from '../../lighting/reflections/radiance/radiance.ts'
import type { beginDisplayFilter } from './encodeDisplayFilter.ts'
import { encodeUnlitLights } from './captureLights.ts'

/** What a capture's view turns off or forces (`ViewOverrides`) ahead of the lighting: the surfaces
 *  rewritten before any light reads them, the lights' buffer cleared of its lights; the main view
 *  does neither. Returns the overrides the rest of the image reads. */
export function encodeViewOverrides(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  surfaces: SurfaceBuffer,
) {
  const overrides = rt.views.active.overrides
  if (rewritesSurfaces(overrides)) encodeSurfaceRewrite(device, encoder, surfaces, overrides)
  if (!overrides.lighting) encodeUnlitLights(rt, device, encoder)
  return overrides
}

/** The image of a view that runs no effect (`ViewOverrides.post`): its lit image is its output,
 *  handed to the reader it names ahead of the radiance turn; nothing is composed nor presented. */
export function finishUncomposed(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  overrides: ViewOverrides,
  filter: ReturnType<typeof beginDisplayFilter>,
) {
  const { gpu } = rt
  overrides.readLit?.(encoder, gpu.hdrView!, gpu.targetSize, gpu.allocatedSize)
  if (filter) filter.active = false
  finishVsmFrame(rt, encoder)
  adoptRadianceImage(gpu)
  return false
}
