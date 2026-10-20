/**
 * THE PROJECTION'S PIPELINES (`projectionPass.ts`): its group layouts and one module per pool layout,
 * specialised by the kinds of light a pass holds (`VSM_TRACE_KINDS`, `../trace/traceWgsl.ts`). A pass of suns
 * alone or of local lights alone runs a pipeline whose trace holds that kind's map, ray and reach
 * alone — no register of the other kind's peak (the crossing ray's second line, the clipmap's
 * fallback) —; a mixed pass the one holding both. And by whether the pass binds translucent
 * casters (`VSM_TRANSMISSION`): without, the panes' gate and walk fold away; with, the pipeline is
 * made the first time a frame asks it. One source, one module: the same light either way.
 */
import {
  COMPUTE,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { hasSubgroupsOf } from '../../../../gpu/core/subgroups.ts'
import { hizDepthEntries } from '../../../../visibility/hiz/gpu/pyramidTexture.ts'
import { preparedComputePipeline, type PreparedPipeline } from '../../../deferred/fullscreen.ts'
import { preparedPipelines } from '../../../../gpu/core/preparedPipelines.ts'
import {
  VSM_PROJECTION_BINDING,
  VSM_PROJECTION_MASK_FORMAT,
  VSM_PROJECTION_THROUGH_FORMAT,
  VSM_PROJECTION_TILE_FORMAT,
  VSM_PROJECTION_VSM_SPECS,
  vsmProjectionWgsl,
} from './projectionWgsl.ts'
import { VSM_PROJECTION_HALF_LANES } from './projectionPixelWgsl.ts'
import {
  VSM_TRACE_KINDS_BOTH,
  VSM_TRACE_KINDS_LOCAL,
  VSM_TRACE_KINDS_SUN,
  vsmTraceKindsOf,
} from '../trace/traceWgsl.ts'
import { vsmBindGroupEntries, vsmBindGroupLayoutEntries, type VsmResources } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { poolWindowSizes } from '../layoutBytes.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'

/** The kind sets a projection is specialised to. */
const KINDS = [VSM_TRACE_KINDS_SUN, VSM_TRACE_KINDS_LOCAL, VSM_TRACE_KINDS_BOTH]
/** A specialisation's key: its kind set, and whether it binds translucent casters. */
const specialisation = (kinds: number, transmission: boolean) => 2 * kinds + (transmission ? 1 : 0)

/** The projection's pass, and its pipelines. */
export const VSM_PROJECTION_PASS = `${VSM_PASS_PREFIX}projection`

/** The projection's layouts for one pool layout — the tables', the pass group's, the receiver
 *  target's —, its module and its pipelines by specialisation (`specialisation`), each made the
 *  first time it is asked (`pipelineOf`): the prepare step asks those without translucent casters,
 *  compiled off the frame; the groups are each set's (`VsmProjectionState`). */
export interface Pipelines {
  device: GPUDevice
  vsmLayout: GPUBindGroupLayout
  passLayout: GPUBindGroupLayout
  receiverLayout: GPUBindGroupLayout
  pipelineLayout: GPUPipelineLayout
  module: GPUShaderModule
  bySpecialisation: Map<number, PreparedPipeline<GPUComputePipeline>>
}

/** The layout of the pass group: the view uniform, the scene's depth, normals and surface flags,
 *  the blue noise, the translucent casters' memory, and the mask, its tiles and its transmission
 *  the pass writes. */
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
      computeStorageTextureEntry(
        VSM_PROJECTION_BINDING.shadowMask,
        VSM_PROJECTION_MASK_FORMAT,
        'write-only',
        '2d-array',
      ),
      computeStorageTextureEntry(
        VSM_PROJECTION_BINDING.shadowMaskTiles,
        VSM_PROJECTION_TILE_FORMAT,
      ),
      computeTextureEntry(VSM_PROJECTION_BINDING.transmission, 'uint', '2d-array'),
      computeStorageTextureEntry(
        VSM_PROJECTION_BINDING.shadowThrough,
        VSM_PROJECTION_THROUGH_FORMAT,
        'write-only',
        '2d-array',
      ),
    ],
  })
}

/** The projection's layouts and module for the pool `layout`; its pipelines made when asked. */
function makePipelines(device: GPUDevice, layout: VsmLayout): Pipelines {
  const vsmLayout = device.createBindGroupLayout({
    label: 'vsm.projection.vsm',
    entries: vsmBindGroupLayoutEntries(VSM_PROJECTION_VSM_SPECS, layout, COMPUTE),
  })
  const passLayout = projectionPassLayout(device)
  // The opaque surfaces read the receiver target in a third group.
  const receiverLayout = device.createBindGroupLayout({
    label: 'vsm.projection.receiver',
    entries: [computeTextureEntry(0, 'uint', '2d', COMPUTE)],
  })
  return {
    device,
    vsmLayout,
    passLayout,
    receiverLayout,
    pipelineLayout: device.createPipelineLayout({
      bindGroupLayouts: [vsmLayout, passLayout, receiverLayout],
    }),
    module: device.createShaderModule({
      label: 'vsm.projection',
      code: vsmProjectionWgsl(layout, hasSubgroupsOf(device, VSM_PROJECTION_HALF_LANES)),
    }),
    bySpecialisation: new Map(),
  }
}

/** The pipeline of `p` for the kind set `kinds` and translucent casters bound or not, made at its
 *  first ask. */
function pipelineOf(p: Pipelines, kinds: number, transmission: boolean) {
  const key = specialisation(kinds, transmission)
  let pipeline = p.bySpecialisation.get(key)
  if (!pipeline) {
    pipeline = preparedComputePipeline(p.device, {
      label: VSM_PROJECTION_PASS,
      layout: p.pipelineLayout,
      compute: {
        module: p.module,
        entryPoint: 'vsmProjection',
        constants: { VSM_TRACE_KINDS: kinds, VSM_TRANSMISSION: transmission ? 1 : 0 },
      },
    })
    p.bySpecialisation.set(key, pipeline)
  }
  return pipeline
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

/** The projection's pipelines for `layout` without translucent casters, every kind set: prepared
 *  by the prepare step (`prepareVsmPipelines`). */
export const vsmProjectionPipeline = (device: GPUDevice, layout: VsmLayout) => {
  const p = pipelinesFor(device, layout)
  return { prepare: () => Promise.all(KINDS.map((kinds) => pipelineOf(p, kinds, false).prepare())) }
}

/** The pipeline of `p` a pass of `lights` runs: the one specialised to their kinds
 *  (`vsmTraceKindsOf`) and to whether it binds translucent casters (`transmission`). */
export function pipelineOfLights(
  p: Pipelines,
  lights: readonly { type: string }[],
  transmission: boolean,
) {
  let sunless = true,
    localless = true
  for (const light of lights)
    if (light.type === 'directional') sunless = false
    else localless = false
  return pipelineOf(p, vsmTraceKindsOf({ sunless, localless }), transmission).get()
}
