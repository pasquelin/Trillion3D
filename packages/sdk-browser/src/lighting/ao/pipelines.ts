import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { computeTextureEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { hizDepthEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { AO_BINDINGS, AO_OCCLUSION_FORMAT, AO_PARAMS_BYTES, AO_SETUP_FORMAT } from './layout.ts'
import { aoOcclusionShader, aoShapeKey, type AoShape } from './occlusionWgsl.ts'
import { AO_SETUP_WGSL } from './setupWgsl.ts'
import { AO_SMOOTH_WGSL } from './smoothWgsl.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'

/** The layout of every occlusion pass's group: its uniform, the depth pyramid, the surfaces' normals, the setup
 *  texture and the coarser occlusion, all read by the fragment stage. The ones a pass does not read are bound to a
 *  stand-in. */
function aoLayoutEntries(): GPUBindGroupLayoutEntry[] {
  const fragment = GPUShaderStage.FRAGMENT
  return [
    computeUniformEntry(AO_BINDINGS.params, { minBindingSize: AO_PARAMS_BYTES }, fragment),
    ...hizDepthEntries(AO_BINDINGS.depth, fragment),
    computeTextureEntry(AO_BINDINGS.normals, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(AO_BINDINGS.setup, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(AO_BINDINGS.lower, 'unfilterable-float', '2d', fragment),
  ]
}

/**
 * THE OCCLUSION'S PROGRAMS, once a device: the setup's and the smoothing's pipelines, and one for each shape of the search an image asks
 * (`AoShape`: the quality, the pass's kind, whether it blends a coarser result), each prepared off the thread, the
 * frame held until they landed (`PreparedPipeline.ask`); the layout of their one group, and the stand-in a setup
 * binding no pass reads is given. A coarser occlusion no pass reads is bound to the lighting's own stand-in
 * (`DeferredPlaceholders.ambientOcclusion`).
 */
export const aoPrograms = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: `${AMBIENT_OCCLUSION_PASS} layout`,
    entries: aoLayoutEntries(),
  })
  const make = (code: string, entry: string, format: GPUTextureFormat, label: string) => {
    const module = device.createShaderModule({ label, code })
    return preparedPipeline(
      device,
      fullscreenDescriptor(device, module, layout, entry, [{ format }], label),
    )
  }
  const setup = make(AO_SETUP_WGSL, 'aoSetup', AO_SETUP_FORMAT, `${AMBIENT_OCCLUSION_PASS} setup`)
  const smooth = make(
    AO_SMOOTH_WGSL,
    'aoSmooth',
    AO_OCCLUSION_FORMAT,
    `${AMBIENT_OCCLUSION_PASS} smooth`,
  )
  const searches = preparedPipelines(
    (shape: AoShape) =>
      make(
        aoOcclusionShader(shape),
        'aoOcclusion',
        AO_OCCLUSION_FORMAT,
        `${AMBIENT_OCCLUSION_PASS} ${aoShapeKey(shape)}`,
      ),
    aoShapeKey,
  )
  // What a pass that reads no setup texture is bound to: the same texel of zero every such pass shares.
  const emptySetup = standInTexture(
    device,
    `${AMBIENT_OCCLUSION_PASS} empty setup`,
    AO_SETUP_FORMAT,
  )
  return {
    device,
    layout,
    setup,
    smooth,
    search: (shape: AoShape) => searches.of(shape),
    emptySetup: emptySetup.createView(),
  }
})
