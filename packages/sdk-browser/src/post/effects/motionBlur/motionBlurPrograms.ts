import { computeTextureEntry, computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { hasSubgroups } from '../../../gpu/core/subgroups.ts'
import { buildRenderPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { MOTION_BLUR_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { scatterShader, SCATTER_BINDINGS } from './dilateWgsl.ts'
import {
  BASE_VARIANT,
  TILE_DEPTH_FORMAT,
  TILE_FORMAT,
  WRITE_ALL,
  WRITE_LARGEST,
  type BlurVariant,
} from './motionBlurLayout.ts'
import { createVariantPrograms, type VariantPrograms } from './motionBlurVariants.ts'

/** A draw of the spread, its depth test and the channels it writes: the shorter smallest motion
 *  or, `largest`, the longer largest. */
async function scatterDraw(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  made: Promise<GPUShaderModule>,
  largest: boolean,
) {
  const module = await made
  return buildRenderPipeline(device, {
    label: `${MOTION_BLUR_PASS} scatter`,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'scatterVertex', constants: { SCATTER_MAX: largest ? 1 : 0 } },
    fragment: {
      module,
      entryPoint: 'scatterFragment',
      targets: [{ format: TILE_FORMAT, writeMask: largest ? WRITE_LARGEST : WRITE_ALL }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      format: TILE_DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: largest ? 'greater' : 'less',
    },
  })
}

/** The drawn spread's layout: the blur's uniform and the tile ranges, read by the vertex stage. */
const scatterLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({
    label: `${MOTION_BLUR_PASS} scatter`,
    entries: [
      computeUniformEntry(SCATTER_BINDINGS.params, {}, GPUShaderStage.VERTEX),
      computeTextureEntry(
        SCATTER_BINDINGS.tiles,
        'unfilterable-float',
        '2d',
        GPUShaderStage.VERTEX,
      ),
    ],
  })

/**
 * The motion blur's programs, once a device, compiled together off the thread: those of its base
 * variant — one direction, the perspective's form of the flattened motion (`createVariantPrograms`) —,
 * the two draws of the drawn spread — the first keeping the shorter smallest motion, the second the
 * longer largest —, and the sampler the filter reads the half-size image with. Its filters take the
 * subgroup's density and vote where the device grants subgroups (`subgroups`).
 */
export async function createMotionBlurPrograms(device: GPUDevice) {
  const subgroups = hasSubgroups(device)
  const layout = scatterLayout(device)
  const scatter = createCheckedShaderModule(device, scatterShader(), `${MOTION_BLUR_PASS} scatter`)
  const [base, scatterSmallest, scatterLargest] = await Promise.all([
    createVariantPrograms(device, BASE_VARIANT, subgroups),
    scatterDraw(device, layout, scatter, false),
    scatterDraw(device, layout, scatter, true),
  ])
  const sampler = device.createSampler({
    label: `${MOTION_BLUR_PASS} sampler`,
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  return { subgroups, scatterLayout: layout, base, scatterSmallest, scatterLargest, sampler }
}

/** The motion blur's programs (`createMotionBlurPrograms`). */
export type MotionBlurPrograms = Awaited<ReturnType<typeof createMotionBlurPrograms>>

/** The programs of another variant than the base, compiled at the first ask (`variantFor`). */
export const createOtherVariant = (
  device: GPUDevice,
  programs: MotionBlurPrograms,
  variant: BlurVariant,
): Promise<VariantPrograms> =>
  createVariantPrograms(device, variant, programs.subgroups, programs.base)
