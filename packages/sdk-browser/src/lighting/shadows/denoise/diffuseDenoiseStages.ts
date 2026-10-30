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
  diffuseFinalWgsl,
  diffusePostFilterWgsl,
  diffusePreConvolveWgsl,
  diffuseReconstructWgsl,
  diffuseTemporalWgsl,
} from './diffuseDenoiseWgsl.ts'

/** The formats of a diffuse sample's two textures: the mean colour with the hit share, and the weight (a count past a half float's ten bits needs a whole float). */
export const DIFFUSE_COLOUR_FORMAT = 'rgba16float'
export const DIFFUSE_WEIGHT_FORMAT = 'r32float'

/** The diffuse signal's passes' stages and layouts, once a device: every pass reads and writes a sample in two textures, and binds no light buffer. */
export const diffuseStagesOf = oncePerDevice((device: GPUDevice) => {
  const make = layoutStagesOf(device, 'Trillion3D diffuse denoise')
  const params = computeUniformEntry(D.params, { minBindingSize: DENOISE_PARAMS_BYTES })
  const source = (binding: number) => computeTextureEntry(binding, 'unfilterable-float')
  const shared = [...inputEntries(GPUShaderStage.COMPUTE), params]
  const out = [
    computeStorageTextureEntry(B.out, DIFFUSE_COLOUR_FORMAT),
    computeStorageTextureEntry(B.outSecond, DIFFUSE_WEIGHT_FORMAT),
  ]
  const sources = [source(D.sourceA), source(D.sourceB)]
  return {
    reconstruct: make(
      'reconstruction',
      device.createShaderModule({
        label: 'Trillion3D diffuse denoise reconstruction',
        code: diffuseReconstructWgsl(),
      }),
      'diffuseReconstruct',
      [...shared, ...sources, ...out],
    ),
    web: make(
      'pre-convolution',
      device.createShaderModule({
        label: 'Trillion3D diffuse denoise pre-convolution',
        code: diffusePreConvolveWgsl(),
      }),
      'diffusePreConvolve',
      [...shared, ...sources, ...out],
    ),
    temporal: make(
      'temporal',
      device.createShaderModule({
        label: 'Trillion3D diffuse denoise temporal',
        code: diffuseTemporalWgsl(),
      }),
      'diffuseTemporal',
      [
        ...shared,
        ...sources,
        source(D.historyA),
        source(D.historyB),
        source(D.prevDepth),
        source(D.prevNormals),
        ...out,
      ],
    ),
    postFilter: make(
      'history convolution',
      device.createShaderModule({
        label: 'Trillion3D diffuse denoise history convolution',
        code: diffusePostFilterWgsl(),
      }),
      'diffusePostFilter',
      [...shared, ...sources, ...out],
    ),
    final: make(
      'output',
      device.createShaderModule({
        label: 'Trillion3D diffuse denoise output',
        code: diffuseFinalWgsl(),
      }),
      'diffuseFinal',
      [params, ...sources, computeStorageTextureEntry(B.out, DIFFUSE_COLOUR_FORMAT)],
    ),
  }
})
