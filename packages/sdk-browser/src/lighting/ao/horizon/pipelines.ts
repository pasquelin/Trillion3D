import {
  COMPUTE,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { preparedPipelines } from '../../../gpu/core/preparedPipelines.ts'
import { standInTexture } from '../../../gpu/core/standIns.ts'
import { hizDepthEntries } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import { VECTOR_FORMAT } from '../../../post/taa/velocityWgsl.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../deferred/fullscreen.ts'
import {
  HORIZON_BINDINGS as B,
  HORIZON_FORMAT,
  HORIZON_PARAMS_BYTES,
  HORIZON_SPATIAL_FORMAT,
} from './layout.ts'
import { HORIZON_SPATIAL_WGSL, HORIZON_TEMPORAL_WGSL, HORIZON_UPSAMPLE_WGSL } from './filterWgsl.ts'
import { horizonCombineShader, horizonShapeKey, type HorizonShape } from './searchWgsl.ts'

/** The layout of every horizon pass's group: its uniform, the depth pyramid, the surfaces' normals, the texture it reads of the
 *  pass before, the history and the vectors of motion, all read by the fragment stage. The ones a pass does not read are bound to
 *  a stand-in. */
function horizonLayoutEntries(): GPUBindGroupLayoutEntry[] {
  const fragment = GPUShaderStage.FRAGMENT
  return [
    computeUniformEntry(B.params, { minBindingSize: HORIZON_PARAMS_BYTES }, fragment),
    ...hizDepthEntries(B.depth, fragment),
    computeTextureEntry(B.normals, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(B.input, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(B.history, 'unfilterable-float', '2d', fragment),
    computeTextureEntry(B.vectors, 'uint', '2d', fragment),
  ]
}

/** The layout of the spatial filter's group, seen by the compute stage: its uniform, the depth pyramid, the texture it reads of
 *  the pass before and the storage texture it writes. */
function spatialLayoutEntries(): GPUBindGroupLayoutEntry[] {
  return [
    computeUniformEntry(B.params, { minBindingSize: HORIZON_PARAMS_BYTES }, COMPUTE),
    ...hizDepthEntries(B.depth, COMPUTE),
    computeTextureEntry(B.input, 'unfilterable-float', '2d', COMPUTE),
    computeStorageTextureEntry(B.spatialOut, HORIZON_SPATIAL_FORMAT),
  ]
}

/** The label of a horizon program. */
const labelOf = (name: string) => `${AMBIENT_OCCLUSION_PASS} horizon ${name}`

/**
 * THE HORIZON SEARCH'S PROGRAMS, once a device: one search for each shape an image asks (`HorizonShape`), the spatial filter (a
 * compute stage, on a layout of its own) and the temporal filter and the upsample, each prepared off the thread, the frame held until they landed
 * (`PreparedPipeline.ask`); the layout of their one group, and the stand-ins a pass that reads no history or no vectors is
 * bound to: a white texel — the history of an image with none: the occlusion of nothing —, and a texel of zero vectors.
 */
export const horizonPrograms = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: labelOf('layout'),
    entries: horizonLayoutEntries(),
  })
  const make = (code: string, entry: string, label: string) => {
    const module = device.createShaderModule({ label, code })
    return preparedPipeline(
      device,
      fullscreenDescriptor(device, module, layout, entry, [{ format: HORIZON_FORMAT }], label),
    )
  }
  const searches = preparedPipelines(
    (shape: HorizonShape) =>
      make(
        horizonCombineShader(shape),
        'hzCombineMain',
        labelOf(`search ${horizonShapeKey(shape)}`),
      ),
    horizonShapeKey,
  )
  const spatialLayout = device.createBindGroupLayout({
    label: labelOf('spatial layout'),
    entries: spatialLayoutEntries(),
  })
  const spatial = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [spatialLayout] }),
    device.createShaderModule({ label: labelOf('spatial'), code: HORIZON_SPATIAL_WGSL }),
    'hzSpatialMain',
    undefined,
    labelOf('spatial'),
  )
  const white = standInTexture(device, labelOf('no history'), HORIZON_FORMAT, { fill: 255 })
  const noVectors = standInTexture(device, labelOf('no vectors'), VECTOR_FORMAT)
  return {
    device,
    layout,
    search: (shape: HorizonShape) => searches.of(shape),
    spatialLayout,
    spatial,
    temporal: make(HORIZON_TEMPORAL_WGSL, 'hzTemporalMain', labelOf('temporal')),
    upsample: make(HORIZON_UPSAMPLE_WGSL, 'hzUpsampleMain', labelOf('upsample')),
    noHistory: white.createView(),
    noVectors: noVectors.createView(),
  }
})
