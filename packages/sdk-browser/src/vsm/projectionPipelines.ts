/**
 * THE PROJECTION'S PIPELINES (`projectionPass.ts`): its group layouts and one module per pool layout,
 * specialised by the kinds of light a pass holds (`VSM_TRACE_KINDS`, `traceWgsl.ts`). A pass of suns
 * alone or of local lights alone runs a pipeline whose trace holds that kind's map, ray and reach
 * alone — no register of the other kind's peak (the crossing ray's second line, the clipmap's
 * fallback) —; a mixed pass the one holding both. One source, one module: the same light either way.
 */
import { COMPUTE, computeTextureEntry, computeUniformEntry } from '../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { hizDepthEntries } from '../gpu/hiz/pyramidTexture.ts'
import { preparedComputePipeline, type PreparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import {
  VSM_PROJECTION_BINDING,
  VSM_PROJECTION_MASK_FORMAT,
  VSM_PROJECTION_TILE_FORMAT,
  VSM_PROJECTION_VSM_SPECS,
  vsmProjectionWgsl,
} from './projectionWgsl.ts'
import { VSM_TRACE_KINDS_BOTH, VSM_TRACE_KINDS_LOCAL, VSM_TRACE_KINDS_SUN } from './traceWgsl.ts'
import { vsmBindGroupEntries, vsmBindGroupLayoutEntries, type VsmResources } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import { poolWindowSizes } from './layoutBytes.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'

/** The kind sets a projection is specialised to. */
const KINDS = [VSM_TRACE_KINDS_SUN, VSM_TRACE_KINDS_LOCAL, VSM_TRACE_KINDS_BOTH]

/** The projection's pass, and its pipelines. */
export const VSM_PROJECTION_PASS = `${VSM_PASS_PREFIX}projection`
/** The projection's layouts for one pool layout and its pipelines, one a kind set
 *  (`VSM_TRACE_KINDS`: suns, local lights, both) of the one module, each compiled off the frame by
 *  the prepare step (at once where a frame asks it first); the groups are each set's
 *  (`VsmProjectionState`). */
export interface Pipelines {
  vsmLayout: GPUBindGroupLayout
  passLayout: GPUBindGroupLayout
  receiverLayout: GPUBindGroupLayout
  device: GPUDevice
  byKinds: Record<number, PreparedPipeline<GPUComputePipeline>>
}

/** The layout of the pass group: the view uniform, the scene's depth, normals and flags, the blue
 *  noise, and the mask and its tiles the pass writes. */
function projectionPassLayout(device: GPUDevice) {
  return device.createBindGroupLayout({
    label: 'vsm.projection.pass',
    entries: [
      computeUniformEntry(VSM_PROJECTION_BINDING.view),
      computeTextureEntry(VSM_PROJECTION_BINDING.sceneDepth, 'depth'),
      computeTextureEntry(VSM_PROJECTION_BINDING.normalRough, 'unfilterable-float'),
      computeTextureEntry(VSM_PROJECTION_BINDING.flags, 'uint'),
      computeTextureEntry(VSM_PROJECTION_BINDING.blueNoise, 'unfilterable-float'),
      ...hizDepthEntries(VSM_PROJECTION_BINDING.hizDepth, COMPUTE),
      {
        binding: VSM_PROJECTION_BINDING.shadowMask,
        visibility: COMPUTE,
        storageTexture: {
          access: 'write-only',
          format: VSM_PROJECTION_MASK_FORMAT,
          viewDimension: '2d-array',
        },
      },
      {
        binding: VSM_PROJECTION_BINDING.shadowMaskTiles,
        visibility: COMPUTE,
        storageTexture: { access: 'write-only', format: VSM_PROJECTION_TILE_FORMAT },
      },
    ],
  })
}

/** The projection's layouts and pipelines for the pool `layout`. */
function makePipelines(device: GPUDevice, layout: VsmLayout): Pipelines {
  const vsmLayout = device.createBindGroupLayout({
    label: 'vsm.projection.vsm',
    entries: vsmBindGroupLayoutEntries(VSM_PROJECTION_VSM_SPECS, layout, COMPUTE),
  })
  const passLayout = projectionPassLayout(device)
  const module = device.createShaderModule({
    label: 'vsm.projection',
    code: vsmProjectionWgsl(layout),
  })
  const receiverLayout = device.createBindGroupLayout({
    label: 'vsm.projection.receiver',
    entries: [computeTextureEntry(0, 'uint', '2d', COMPUTE)],
  })
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [vsmLayout, passLayout, receiverLayout],
  })
  return {
    device,
    vsmLayout,
    passLayout,
    receiverLayout,
    byKinds: Object.fromEntries(
      KINDS.map((kinds) => [
        kinds,
        preparedComputePipeline(device, {
          label: VSM_PROJECTION_PASS,
          layout: pipelineLayout,
          compute: { module, entryPoint: 'vsmProjection', constants: { VSM_TRACE_KINDS: kinds } },
        }),
      ]),
    ),
  }
}

/** The device's projections, by the pool layout they were compiled for, made once a device. */
const projections = oncePerDevice((device: GPUDevice) =>
  preparedPipelines(
    (layout: VsmLayout) => makePipelines(device, layout),
    (layout) => `${poolWindowSizes(layout).length}|${layout.poolRowShift}`,
  ),
)

/** The projection of `device` for `layout` (`projections`). */
export const pipelinesFor = (device: GPUDevice, layout: VsmLayout) => projections(device).of(layout)

/** Group 0 of `p` over the tables of `res.current` (`vsmPerFrameSet`). */
export const tablesGroup = (res: VsmResources, p: Pipelines) =>
  p.device.createBindGroup({
    label: 'vsm.projection.vsm',
    layout: p.vsmLayout,
    entries: vsmBindGroupEntries(res, VSM_PROJECTION_VSM_SPECS),
  })

/** The projection's pipelines for `layout`, every kind set: prepared by the prepare step
 *  (`prepareVsmPipelines`). */
export const vsmProjectionPipeline = (device: GPUDevice, layout: VsmLayout) => {
  const { byKinds } = pipelinesFor(device, layout)
  return { prepare: () => Promise.all(KINDS.map((kinds) => byKinds[kinds].prepare())) }
}

/** The pipeline of `p` a pass of `lights` runs: the one specialised to their kinds. */
export function pipelineOfLights(p: Pipelines, lights: readonly { type: string }[]) {
  let sun = false,
    local = false
  for (const light of lights)
    if (light.type === 'directional') sun = true
    else local = true
  const kinds =
    sun && local ? VSM_TRACE_KINDS_BOTH : sun ? VSM_TRACE_KINDS_SUN : VSM_TRACE_KINDS_LOCAL
  return p.byKinds[kinds].get()
}
