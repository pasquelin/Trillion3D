import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { BlendableLocation } from '../../../../sdk-core/src/world/material/postProcessMaterial.ts'
import { customDepthWritesStencil } from '../../../../sdk-core/src/contracts/customDepthOptions.ts'
import { readCustomDepthSetting } from '../../../../sdk-core/src/contracts/customDepthOptions.ts'
import { readPostProcessMaterialSetting } from '../../../../sdk-core/src/contracts/postProcessMaterialOptions.ts'
import { HDR_FORMAT, DISPLAY_FORMAT } from '../../scene/targetFormats.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { nameUndrawnBlendables, usablePostProgram } from '../../post/materials/postProgram.ts'
import type { PostCall } from '../../post/materials/postMaterials.ts'
import { webgpuEffects } from './effectsFrame.ts'
import { beautyImage } from '../prepare/lit.ts'
import { customDepthOf } from './encodeCustomDepth.ts'

/** The revision an image drawn while the chain compiles keeps: no chain's, which count from 0. */
export const COMPILING = -1

/**
 * THE POST-PROCESS MATERIALS IN THE FRAME (`world.effects.blendables`, `material.postProcess`): at each place the image offers them, the
 * materials the chain holds for that location (`Blendables.chainAt`) are drawn over the image there, in the order of their priority, each
 * over what the one before wrote, unless the settings turn them off (`postProcessMaterials`, `postProcessDisableMaterials`). The places are
 * the ones of the image's making, in its order: the lit image ahead of the depth of field and after it (`sceneColorBeforeDof`,
 * `sceneColorAfterDof`), the resolved image after the temporal pass and the motion blur, ahead of the bloom (`sceneColorBeforeBloom`), and
 * the display image after the tone mapping (`sceneColorAfterTonemapping`). A chain with no blendable at a place draws nothing, makes
 * nothing and returns the image it was given.
 */

/** Whether the settings let the materials draw. */
const materialsOn = (rt: WebgpuPagesRuntime) =>
  readPostProcessMaterialSetting(rt, 'postProcessMaterials') &&
  !readPostProcessMaterialSetting(rt, 'postProcessDisableMaterials')

/** The call for the materials of `location` on `input`, `size` pixels in textures of `extent`; the encoder is set by the caller. */
function callOf(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  location: BlendableLocation,
  chain: PostCall['chain'],
  input: GPUTextureView,
  format: GPUTextureFormat,
  size: readonly number[],
  extent: readonly number[],
): PostCall {
  const { gpu, run } = rt
  const cam = run.gate.cam
  const custom = customDepthOf(rt)
  return {
    encoder,
    location,
    chain,
    input,
    format,
    frame: {
      projection: cam.projection,
      perspective: cam.perspective !== 0,
      image: [size[0], size[1], extent[0], extent[1]],
      scene: [gpu.targetSize[0], gpu.targetSize[1], gpu.allocatedSize[0], gpu.allocatedSize[1]],
      custom: custom ? [custom.size[0], custom.size[1]] : [1, 1],
    },
    lit: gpu.hdrView!,
    depth: gpu.depthView!,
    customDepth: custom?.depth,
    customStencil: custom?.stencil,
    stencilAllocated: customDepthWritesStencil(readCustomDepthSetting(rt, 'customDepth')),
    clocks: run.graphClocks,
    preExposure: preExposureOf(rt).now,
    allowStencil: readPostProcessMaterialSetting(rt, 'postProcessAllowStencilTest'),
    allowBlend: readPostProcessMaterialSetting(rt, 'postProcessAllowBlendModes'),
  }
}

/** The chain's materials of `location`, none while there are none, the settings turn them off or their code has not arrived: then the
 *  image is drawn again once it has (`COMPILING`). */
function materialsAt(rt: WebgpuPagesRuntime, device: GPUDevice, location: BlendableLocation) {
  const chain = rt.context.effects?.blendables
  if (!chain?.size) {
    if (rt.gpu.effects?.materials.bytes) rt.gpu.effects.materials.release()
    return undefined
  }
  nameUndrawnBlendables(chain.entries)
  const materials = chain.chainAt(location)
  if (!materials.length || !materialsOn(rt)) return undefined
  const effects = webgpuEffects(rt, device)
  if (!effects) {
    rt.gpu.effectsRevision = COMPILING
    return undefined
  }
  return { materials, effects, all: chain.entries }
}

/**
 * The materials of `location` drawn over `input` — the lit image or the image the temporal pass resolved —, `size` pixels of textures
 * of `extent`; returns the image after them, `input` itself when none drew.
 */
export function encodeBlendablesOver(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  location: BlendableLocation,
  input: GPUTextureView,
  size: readonly number[],
  extent: readonly number[],
) {
  const at = materialsAt(rt, device, location)
  if (!at || !rt.gpu.hdrView || !rt.gpu.depthView) return input
  const call = callOf(rt, encoder, location, at.materials, input, HDR_FORMAT, size, extent)
  const output = at.effects.materials.apply(call, at.all)
  if (output !== input) rt.run.gpuDrawCalls += at.materials.length
  return output
}

/** Whether a blendable draws over the display image of this image: the composition then writes the display colour. Only for a beauty image
 *  whose chain holds, after the tone mapping, a material the settings let draw and whose code has arrived, the passes ready to draw it. */
export const displayBlendablesDrawn = (rt: WebgpuPagesRuntime) => {
  const chain = rt.context.effects?.blendables
  const { gpu } = rt
  return (
    !!chain?.size &&
    beautyImage(rt) &&
    !!gpu.effects &&
    !!gpu.hdrView &&
    !!gpu.depthView &&
    materialsOn(rt) &&
    chain.chainAt('sceneColorAfterTonemapping').some(({ material }) => usablePostProgram(material))
  )
}

/**
 * The materials that join the image after the tone mapping, drawn over the display image `display` and the canvas it was presented to
 * (`presentation`): they read the image as it stands and write another, copied back over both. Returns the render passes encoded.
 */
export function encodeDisplayBlendables(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  display: GPUTextureView,
  presentation: GPUTextureView | undefined,
) {
  const location = 'sceneColorAfterTonemapping'
  const at = materialsAt(rt, device, location)
  if (!at || !rt.gpu.hdrView || !rt.gpu.depthView) return 0
  const size = rt.gpu.displaySize
  const call = callOf(rt, encoder, location, at.materials, display, DISPLAY_FORMAT, size, size)
  const output = at.effects.materials.apply(call, at.all)
  if (output === display) return 0
  at.effects.materials.copyOnto(encoder, output, display, presentation, size[0], size[1])
  return at.materials.length + 1
}

/** Whether a blendable's graph reads the time: a quiet view is then drawn again at each frame (`drawsEveryImage`). */
export function blendablesAnimated(rt: WebgpuPagesRuntime) {
  const chain = rt.context.effects?.blendables
  if (!chain?.size || !materialsOn(rt)) return false
  for (const { material } of chain.entries) if (usablePostProgram(material)?.animated) return true
  return false
}
