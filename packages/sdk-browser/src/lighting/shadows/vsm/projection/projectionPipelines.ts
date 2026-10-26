/**
 * THE PROJECTION'S PIPELINES (`projectionPass.ts`): its group layouts and one module per pool layout
 * for each of its two passes — the suns' and the local lights' (`projectionWgsl.ts`) —, the local
 * lights' once for each format of the mask it writes (`maskFormat.ts`). A pass of suns alone or of
 * local lights alone holds that kind's map, ray and reach alone — no register of the other kind's
 * peak (the crossing ray's second line, the clipmap's fallback).
 */
import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { hasSubgroups, hasSubgroupsOf } from '../../../../gpu/core/subgroups.ts'
import { hizDepthEntries } from '../../../../visibility/hiz/gpu/pyramidTexture.ts'
import { preparedComputePipeline, type PreparedPipeline } from '../../../deferred/fullscreen.ts'
import { preparedPipelines } from '../../../../gpu/core/preparedPipelines.ts'
import {
  VSM_PROJECTION_BINDING,
  VSM_PROJECTION_VSM_SPECS,
  vsmLocalsProjectionWgsl,
  vsmSunsProjectionWgsl,
} from './projectionWgsl.ts'
import { onePassMaskFormat, VSM_SUN_MASK_FORMAT } from './maskFormat.ts'
import { VSM_PROJECTION_HALF_LANES } from './projectionPixelWgsl.ts'
import { SUBSURFACE_FORMAT } from '../../../../materials/surface/subsurface.ts'
import { PHYSICAL_LOBES_FORMAT } from '../../../../materials/surface/physicalLobes.ts'
import { vsmBindGroupEntries, vsmBindGroupLayoutEntries, type VsmResources } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'

/** The projection's pass, and its pipelines. */
export const VSM_PROJECTION_PASS = `${VSM_PASS_PREFIX}projection`

type MaskFormat = ReturnType<typeof onePassMaskFormat>

/** One of the projection's passes for one pool layout: its group layout, pipeline layout and
 *  module(s) and pipelines, each made the first time it is asked (`sunsPipeline`, `localsPipeline`): the
 *  prepare step asks them, compiled off the frame; the groups are each set's (`VsmProjectionState`). */
export interface Pipelines {
  device: GPUDevice
  vsmLayout: GPUBindGroupLayout
  sunsLayout: GPUBindGroupLayout
  sunsPipelineLayout: GPUPipelineLayout
  layout: VsmLayout
  suns?: PreparedPipeline<GPUComputePipeline>
  /** The local lights' pass for each format of the mask, with the group layout its mask is bound by. */
  locals: Map<MaskFormat, LocalsPass>
}
interface LocalsPass {
  groupLayout: GPUBindGroupLayout
  pipeline: PreparedPipeline<GPUComputePipeline>
}

/** The bindings the two passes' groups share: the view uniform, the scene's depth, normals and
 *  surface flags, the blue noise, the depth pyramid and the thin transmission. */
const sharedEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(VSM_PROJECTION_BINDING.view),
  computeTextureEntry(VSM_PROJECTION_BINDING.sceneDepth, 'depth'),
  computeTextureEntry(VSM_PROJECTION_BINDING.normalRough, 'unfilterable-float'),
  computeTextureEntry(VSM_PROJECTION_BINDING.flags, 'uint'),
  computeTextureEntry(VSM_PROJECTION_BINDING.blueNoise, 'unfilterable-float'),
  ...hizDepthEntries(VSM_PROJECTION_BINDING.hizDepth, COMPUTE),
  computeStorageTextureEntry(VSM_PROJECTION_BINDING.subsurface, SUBSURFACE_FORMAT, 'read-only'),
  computeStorageTextureEntry(VSM_PROJECTION_BINDING.lobes, PHYSICAL_LOBES_FORMAT, 'read-only'),
]

/** The suns' pass group: the shared bindings and the suns' mask the pass writes. */
const sunsLayoutOf = (device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'vsm.projection.suns',
    entries: [
      ...sharedEntries(),
      computeStorageTextureEntry(
        VSM_PROJECTION_BINDING.mask,
        VSM_SUN_MASK_FORMAT,
        'write-only',
        '2d-array',
      ),
    ],
  })

/** The local lights' pass group: the shared bindings, the engine's deferred view, the lights and the
 *  light grid's lists the pass walks, the shadowed lights' grid the marking pruned, and the mask it
 *  writes. */
const localsLayoutOf = (device: GPUDevice, format: MaskFormat) =>
  device.createBindGroupLayout({
    label: `vsm.projection.locals.${format}`,
    entries: [
      ...sharedEntries(),
      computeUniformEntry(VSM_PROJECTION_BINDING.deferredView),
      computeBufferEntry(VSM_PROJECTION_BINDING.directLights, 'read-only-storage'),
      computeBufferEntry(VSM_PROJECTION_BINDING.tileLights, 'read-only-storage'),
      computeBufferEntry(VSM_PROJECTION_BINDING.lightGrid, 'read-only-storage'),
      computeStorageTextureEntry(VSM_PROJECTION_BINDING.mask, format, 'write-only'),
    ],
  })

/** The projection's layouts and pipelines for the pool `layout`; its pipelines made when asked. */
function makePipelines(device: GPUDevice, layout: VsmLayout): Pipelines {
  const vsmLayout = device.createBindGroupLayout({
    label: 'vsm.projection.vsm',
    entries: vsmBindGroupLayoutEntries(VSM_PROJECTION_VSM_SPECS, COMPUTE),
  })
  const sunsLayout = sunsLayoutOf(device)
  return {
    device,
    layout,
    vsmLayout,
    sunsLayout,
    sunsPipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [vsmLayout, sunsLayout] }),
    locals: new Map(),
  }
}

/** The suns' pipeline of `p`, made at its first ask. */
export function sunsPipeline(p: Pipelines) {
  return (p.suns ??= preparedComputePipeline(p.device, {
    label: VSM_PROJECTION_PASS,
    layout: p.sunsPipelineLayout,
    compute: {
      module: p.device.createShaderModule({
        label: 'vsm.projection.suns',
        code: vsmSunsProjectionWgsl(p.layout, hasSubgroupsOf(p.device, VSM_PROJECTION_HALF_LANES)),
      }),
      entryPoint: 'vsmProjectSuns',
    },
  }))
}

/** The local lights' pipeline of `p` writing a mask of `format`, made at its first ask. */
export function localsPipeline(p: Pipelines, format: MaskFormat) {
  let pass = p.locals.get(format)
  if (!pass) {
    const groupLayout = localsLayoutOf(p.device, format)
    const layout = p.device.createPipelineLayout({ bindGroupLayouts: [p.vsmLayout, groupLayout] })
    const module = p.device.createShaderModule({
      label: `vsm.projection.locals.${format}`,
      code: vsmLocalsProjectionWgsl(p.layout, format, hasSubgroups(p.device)),
    })
    pass = {
      groupLayout,
      pipeline: preparedComputePipeline(p.device, {
        label: VSM_PROJECTION_PASS,
        layout,
        compute: { module, entryPoint: 'vsmProjectLocals' },
      }),
    }
    p.locals.set(format, pass)
  }
  return pass
}

/** The device's projections, by the pool layout they were compiled for, made once a device. */
const projections = oncePerDevice((device: GPUDevice) =>
  preparedPipelines(
    (layout: VsmLayout) => makePipelines(device, layout),
    (layout) => `${layout.poolRowShift}`,
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

/** The projection's pipelines for `layout`: the suns' and the local lights' of the mask's `format`,
 *  prepared by the prepare step (`prepareVsmPipelines`). */
export const vsmProjectionPipeline = (device: GPUDevice, layout: VsmLayout, format: MaskFormat) => {
  const p = pipelinesFor(device, layout)
  return {
    prepare: () => {
      const locals = localsPipeline(p, format)
      return Promise.all([sunsPipeline(p).prepare(), locals.pipeline.prepare()])
    },
  }
}
