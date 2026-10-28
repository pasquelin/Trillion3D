// The post-processing passes' WGSL texts of `ENGINE_SHADERS`: depth of field, bloom, filters, tone finishing and exposure metering.
import { BLOOM_COMPOSITE_WGSL, BLOOM_SETUP_WGSL } from '../../post/effects/bloom/bloomWgsl.ts'
import { fftShader } from '../../post/effects/bloom/convolution/fftWgsl.ts'
import { KERNEL_WGSL } from '../../post/effects/bloom/convolution/kernelWgsl.ts'
import { CONVOLUTION_INPUT_WGSL } from '../../post/effects/bloom/convolution/inputWgsl.ts'
import {
  setupFullShader,
  setupHalfShader,
  cocDownsampleShader,
} from '../../post/effects/depthOfField/dofSetupWgsl.ts'
import { dofTemporalShader } from '../../post/effects/depthOfField/dofTemporalWgsl.ts'
import { dilateShader, cocFlattenShader } from '../../post/effects/depthOfField/dofTilesWgsl.ts'
import { dofReduceShader } from '../../post/effects/depthOfField/dofReduceWgsl.ts'
import { bokehLutShader } from '../../post/effects/depthOfField/dofLutWgsl.ts'
import { dofGatherShader } from '../../post/effects/depthOfField/dofGatherWgsl.ts'
import { dofPostfilterShader } from '../../post/effects/depthOfField/dofPostfilterWgsl.ts'
import { packShader, spriteShader } from '../../post/effects/depthOfField/dofScatterWgsl.ts'
import { dofRecombineShader } from '../../post/effects/depthOfField/dofRecombineMainWgsl.ts'
import { DOWNSAMPLE_WGSL } from '../../post/filters/downsampleWgsl.ts'
import { GAUSSIAN_WGSL } from '../../post/filters/gaussianWgsl.ts'
import { gridWgsl, LOG_LIGHT_WGSL } from '../../post/finish/localWgsl.ts'
import { BASIC_SETUP_WGSL } from '../../post/exposure/basicWgsl.ts'
import { ADAPT_WGSL, MEASURE_WGSL } from '../../post/exposure/meterWgsl.ts'
import { toneBakeShader } from '../../lighting/toneBakeWgsl.ts'

export const POST_SHADERS: Record<string, string> = {
  // The depth of field's passes (`../../post/effects/depthOfField/`), each at its pipeline constants' defaults.
  DOF_SETUP_HALF: setupHalfShader(),
  DOF_SETUP_FULL: setupFullShader(),
  DOF_TEMPORAL: dofTemporalShader(),
  DOF_COC_FLATTEN: cocFlattenShader(),
  DOF_COC_DILATE: dilateShader(),
  DOF_DOWNSAMPLE: cocDownsampleShader(),
  DOF_REDUCE: dofReduceShader(),
  DOF_PACK: packShader(),
  DOF_LUT: bokehLutShader(),
  DOF_GATHER: dofGatherShader(),
  DOF_POSTFILTER: dofPostfilterShader(),
  DOF_SPRITES: spriteShader(),
  DOF_RECOMBINE: dofRecombineShader(),
  BLOOM_SETUP_WGSL,
  BLOOM_COMPOSITE_WGSL,
  // The convolution bloom's transform (a line of the device's workgroup memory: 2048 or 4096 values),
  // the kernel's preparation and the image the transform reads.
  BLOOM_FFT_2048: fftShader(2048),
  BLOOM_FFT_4096: fftShader(4096),
  BLOOM_KERNEL_WGSL: KERNEL_WGSL,
  BLOOM_CONVOLUTION_INPUT_WGSL: CONVOLUTION_INPUT_WGSL,
  DOWNSAMPLE_WGSL,
  GAUSSIAN_WGSL,
  GRID_WGSL_RG32: gridWgsl('rg32float'),
  GRID_WGSL_RGBA16: gridWgsl('rgba16float'),
  LOG_LIGHT_WGSL,
  MEASURE_WGSL,
  BASIC_SETUP_WGSL,
  ADAPT_WGSL,
  // The tone table's baking (`../../lighting/toneLut.ts`), in the half float and in the packed format.
  TONE_BAKE_HALF: toneBakeShader('rgba16float'),
  TONE_BAKE_PACKED: toneBakeShader('rgb10a2unorm'),
}
