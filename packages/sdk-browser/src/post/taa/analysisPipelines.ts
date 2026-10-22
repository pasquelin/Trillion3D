import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { makeFullscreenPipeline } from '../../lighting/deferred/fullscreen.ts'
import { buildComputeStage } from '../../gpu/core/computeStages.ts'
import { GUARANTEED_WORKGROUP_BYTES, workgroupStorageBytes } from '../../gpu/core/textureLimits.ts'
import type { AnalysisLayouts } from './analysisLayouts.ts'
import type { TilePlan } from './tileWgsl.ts'
import { TEXEL_TILE } from './velocityWgsl.ts'
import { velocityShader } from './nearestVelocityWgsl.ts'
import { reprojectShader } from './reprojectWgsl.ts'
import { FLICKER_PLAN, flickerPlanFor, flickerShader } from './flickerWgsl.ts'
import { THIN_GEOMETRY_PLAN, thinGeometryShader } from './thinGeometryWgsl.ts'
import {
  HELD_MEASURE_PLAN,
  REJECTION_PLAN,
  heldMeasureShader,
  rejectionShader,
} from './rejectionWgsl.ts'
import { ANTI_ALIASING_FORMAT, spatialAntiAliasingShader } from './spatialAntiAliasingWgsl.ts'

/** Compiles one program of the analysis on `layout`, its entry point `entryPoint`. */
type Stage = (
  layout: GPUBindGroupLayout,
  module: Promise<GPUShaderModule>,
  entryPoint: string,
) => ReturnType<typeof buildComputeStage>

/** The render texels a workgroup of each dispatch covers, across and down, in their order: the
 *  nearest velocity and the reprojection, a texel a lane, the thin geometry detection, the flicker
 *  measure (of the `flicker` plan the device's workgroup memory allows), the held measure and the
 *  rejection, a tile each. */
const tilesOf = (flicker: TilePlan) =>
  [
    [TEXEL_TILE, TEXEL_TILE],
    [TEXEL_TILE, TEXEL_TILE],
    [THIN_GEOMETRY_PLAN.width, THIN_GEOMETRY_PLAN.height],
    [flicker.width, flicker.height],
    [HELD_MEASURE_PLAN.width, HELD_MEASURE_PLAN.height],
    [REJECTION_PLAN.width, REJECTION_PLAN.height],
  ] as const
/** The thin geometry detection's and the flicker measure's places among them. */
export const THIN_DISPATCH = 2
export const FLICKER_DISPATCH = 3

/** The flicker measure built over the tile the device's workgroup memory allows, with the plan it
 *  was built over; a pipeline whose compile refuses it anyway — a compiled kernel caps its threads
 *  by what it uses, which no limit names — is built over the narrow plan, the one every device
 *  holds. */
async function flickerStage(device: GPUDevice, stage: Stage, layout: GPUBindGroupLayout) {
  const bytes = workgroupStorageBytes(device.limits)
  const built = async (plan: TilePlan, workgroupBytes: number) => ({
    plan,
    pipeline: await stage(
      layout,
      createCheckedShaderModule(device, flickerShader(plan, workgroupBytes), 'TAA_FLICKER'),
      'flickerMeasure',
    ),
  })
  const wanted = flickerPlanFor(bytes)
  return built(wanted, bytes).catch((error) => {
    if (wanted === FLICKER_PLAN) throw error
    return built(FLICKER_PLAN, GUARANTEED_WORKGROUP_BYTES)
  })
}

/** The compute programs of the analysis, compiled together off the thread. */
async function computePipelines(device: GPUDevice, layouts: AnalysisLayouts) {
  // Each text is compiled at its call, so the call names what it compiles.
  const stage: Stage = async (layout, module, entryPoint) => {
    const compiled = await module
    return buildComputeStage(device, [layout], compiled, entryPoint, undefined, compiled.label)
  }
  const [velocity, reproject, thin, flicker, held, rejection] = await Promise.all([
    stage(
      layouts.velocity,
      createCheckedShaderModule(device, velocityShader(), 'TAA_VELOCITY'),
      'nearestVelocity',
    ),
    stage(
      layouts.reproject,
      createCheckedShaderModule(device, reprojectShader(), 'TAA_REPROJECT'),
      'reprojectHistories',
    ),
    stage(
      layouts.thin,
      createCheckedShaderModule(device, thinGeometryShader(), 'TAA_THIN_GEOMETRY'),
      'detectThinGeometry',
    ),
    flickerStage(device, stage, layouts.flicker),
    stage(
      layouts.held,
      createCheckedShaderModule(device, heldMeasureShader(), 'TAA_HELD_MEASURE'),
      'heldMeasure',
    ),
    stage(
      layouts.rejection,
      createCheckedShaderModule(device, rejectionShader(), 'TAA_REJECTION'),
      'shadingRejection',
    ),
  ])
  return { pipelines: [velocity, reproject, thin, flicker.pipeline, held, rejection], flicker }
}

/**
 * The analysis's programs: its dispatches' compute pipelines, in the order of their `tiles`, and the
 * spatial anti-aliaser's draw.
 */
export async function createAnalysisPipelines(device: GPUDevice, layouts: AnalysisLayouts) {
  const [{ pipelines, flicker }, antiAlias] = await Promise.all([
    computePipelines(device, layouts),
    createCheckedShaderModule(device, spatialAntiAliasingShader(), 'TAA_SPATIAL_AA').then(
      (module) =>
        makeFullscreenPipeline(device, module, layouts.antiAlias, 'spatialAntiAliasing', [
          { format: ANTI_ALIASING_FORMAT },
        ]),
    ),
  ])
  return { pipelines, tiles: tilesOf(flicker.plan), antiAlias }
}
