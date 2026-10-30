import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { layoutStagesOf } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import {
  DENOISE_BINDINGS as D,
  DENOISE_PARAMS_BYTES,
} from '../../screenSpaceTracing/denoise/denoiseView.ts'
import { inputEntries } from '../../screenSpaceTracing/pipelines.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../../screenSpaceTracing/rayCastWgsl.ts'
import {
  occlusionFinalWgsl,
  occlusionInjestWgsl,
  occlusionRejectionWgsl,
  occlusionTemporalWgsl,
} from './occlusionDenoiseWgsl.ts'
import { shadowSpatialWgsl } from './shadowDenoiseSpatialWgsl.ts'

const HISTORY_FORMAT = 'rgba16float'

/** The occlusion's passes' stages and layouts, once a device: the shadow's, beside no light buffer, with the injestion of the trace's distance, the rejection pre-convolution and the accumulation that reads it. */
export const occlusionStagesOf = oncePerDevice((device: GPUDevice) => {
  const make = layoutStagesOf(device, 'Trillion3D occlusion denoise')
  const params = computeUniformEntry(D.params, { minBindingSize: DENOISE_PARAMS_BYTES })
  const source = (binding: number) => computeTextureEntry(binding, 'unfilterable-float')
  const shared = [...inputEntries(GPUShaderStage.COMPUTE), params]
  const out = computeStorageTextureEntry(B.out, HISTORY_FORMAT)
  const spatial = (name: string, compiled: GPUShaderModule, entry: string) =>
    make(name, compiled, entry, [...shared, source(D.sourceA), out])
  return {
    injest: make(
      'injest',
      device.createShaderModule({
        label: 'Trillion3D occlusion denoise injest',
        code: occlusionInjestWgsl(),
      }),
      'occlusionInject',
      [...shared, source(D.sourceA), source(D.sourceB), out],
    ),
    reconstruct: spatial(
      'reconstruction',
      device.createShaderModule({
        label: 'Trillion3D occlusion denoise reconstruction',
        code: shadowSpatialWgsl('reconstruct', 'occlusion'),
      }),
      'occlusionReconstruct',
    ),
    web: spatial(
      'pre-convolution',
      device.createShaderModule({
        label: 'Trillion3D occlusion denoise pre-convolution',
        code: shadowSpatialWgsl('web', 'occlusion'),
      }),
      'occlusionPreConvolve',
    ),
    postFilter: spatial(
      'history convolution',
      device.createShaderModule({
        label: 'Trillion3D occlusion denoise history convolution',
        code: shadowSpatialWgsl('postFilter', 'occlusion'),
      }),
      'occlusionPostFilter',
    ),
    rejection: make(
      'rejection pre-convolution',
      device.createShaderModule({
        label: 'Trillion3D occlusion denoise rejection pre-convolution',
        code: occlusionRejectionWgsl(),
      }),
      'occlusionRejection',
      [...shared, source(D.sourceA), out],
    ),
    temporal: make(
      'temporal',
      device.createShaderModule({
        label: 'Trillion3D occlusion denoise temporal',
        code: occlusionTemporalWgsl(),
      }),
      'occlusionTemporal',
      [
        ...shared,
        source(D.sourceA),
        source(D.sourceB),
        source(D.historyA),
        source(D.prevDepth),
        source(D.prevNormals),
        out,
      ],
    ),
    final: make(
      'output',
      device.createShaderModule({
        label: 'Trillion3D occlusion denoise output',
        code: occlusionFinalWgsl(),
      }),
      'occlusionFinal',
      [params, source(D.sourceA), computeStorageTextureEntry(B.out, HISTORY_FORMAT)],
    ),
  }
})
