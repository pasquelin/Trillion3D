// The post-processing passes' WGSL texts of `ENGINE_SHADERS`: motion blur, depth of field, bloom, filters, tone finishing and exposure metering.
import { BLOOM_COMPOSITE_WGSL, BLOOM_SETUP_WGSL } from '../../post/effects/bloom/bloomWgsl.ts'
import { fftShader } from '../../post/effects/bloom/convolution/fftWgsl.ts'
import { KERNEL_WGSL } from '../../post/effects/bloom/convolution/kernelWgsl.ts'
import { CONVOLUTION_INPUT_WGSL } from '../../post/effects/bloom/convolution/inputWgsl.ts'
import { GLOW_FINISH_WGSL } from '../../post/effects/bloom/glowFinishWgsl.ts'
import { flattenShader } from '../../post/effects/motionBlur/flattenWgsl.ts'
import { gatherShader, scatterShader } from '../../post/effects/motionBlur/dilateWgsl.ts'
import { classifyShader } from '../../post/effects/motionBlur/classifyWgsl.ts'
import { filterShader } from '../../post/effects/motionBlur/filterWgsl.ts'
import {
  setupFullShader,
  setupHalfShader,
  cocDownsampleShader,
} from '../../post/effects/depthOfField/dofSetupWgsl.ts'
import { dilateShader, cocFlattenShader } from '../../post/effects/depthOfField/dofTilesWgsl.ts'
import { dofReduceShader } from '../../post/effects/depthOfField/dofReduceWgsl.ts'
import { bokehLutShader } from '../../post/effects/depthOfField/dofLutWgsl.ts'
import { dofGatherShader } from '../../post/effects/depthOfField/dofGatherWgsl.ts'
import { dofPostfilterShader } from '../../post/effects/depthOfField/dofPostfilterWgsl.ts'
import { packShader, spriteShader } from '../../post/effects/depthOfField/dofScatterWgsl.ts'
import { dofRecombineShader } from '../../post/effects/depthOfField/dofRecombineMainWgsl.ts'
import { filterTwoShader } from '../../post/effects/motionBlur/weighTwoWgsl.ts'
import { DOWNSAMPLE_WGSL } from '../../post/filters/downsampleWgsl.ts'
import { GAUSSIAN_WGSL } from '../../post/filters/gaussianWgsl.ts'
import { GRID_WGSL, LOG_LIGHT_WGSL } from '../../post/finish/localWgsl.ts'
import { ADAPT_WGSL, MEASURE_WGSL } from '../../post/exposure/meterWgsl.ts'

export const POST_SHADERS: Record<string, string> = {
  MOTION_BLUR_FLATTEN: flattenShader(),
  MOTION_BLUR_GATHER: gatherShader(),
  MOTION_BLUR_SCATTER: scatterShader(),
  MOTION_BLUR_CLASSIFY: classifyShader(),
  MOTION_BLUR_FILTER: filterShader(),
  MOTION_BLUR_FLATTEN_TWO: flattenShader(2),
  MOTION_BLUR_GATHER_TWO: gatherShader(2),
  MOTION_BLUR_GATHER_TWO_DRAWN: gatherShader(2, true),
  MOTION_BLUR_CLASSIFY_TWO: classifyShader(2),
  MOTION_BLUR_FILTER_TWO: filterTwoShader(),
  // The depth of field's passes (`../../post/effects/depthOfField/`), each at its pipeline constants' defaults.
  DOF_SETUP_HALF: setupHalfShader(),
  DOF_SETUP_FULL: setupFullShader(),
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
  // the kernel's preparation, the image the transform reads and the glow's finishing.
  BLOOM_FFT_2048: fftShader(2048),
  BLOOM_FFT_4096: fftShader(4096),
  BLOOM_KERNEL_WGSL: KERNEL_WGSL,
  BLOOM_CONVOLUTION_INPUT_WGSL: CONVOLUTION_INPUT_WGSL,
  BLOOM_GLOW_FINISH_WGSL: GLOW_FINISH_WGSL,
  DOWNSAMPLE_WGSL,
  GAUSSIAN_WGSL,
  GRID_WGSL,
  LOG_LIGHT_WGSL,
  MEASURE_WGSL,
  ADAPT_WGSL,
}
