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
import { gpuCapsOf, nativeOrPolyfill } from '../../../../gpu/core/gpuCaps.ts'
import { hasSubgroupsOf } from '../../../../gpu/core/subgroups.ts'
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
import { vsmBindGroupLayoutEntries, vsmSpecGroup, type VsmResources } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import type { VsmInputType } from '../inputType.ts'
import type { PerLightPipelines } from './perLightPipelines.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'

/** The projection's pass, and its pipelines. */
export const VSM_PROJECTION_PASS = `${VSM_PASS_PREFIX}projection`

type MaskFormat = ReturnType<typeof onePassMaskFormat>

/** One of the projection's passes for one pool layout: its group layout, pipeline layout and
 *  module(s) and pipelines, each made the first time it is asked (`sunsPipeline`, `localsPipeline`): the
 *  prepare step asks them, compiled off the frame; the groups are each set's (`VsmProjectionState`). */
export interface Pipelines extends InputPipelines {
  device: GPUDevice
  vsmLayout: GPUBindGroupLayout
  layout: VsmLayout
  /** The passes over the hair strands (input `strands`, `../inputType.ts`), made at their first ask. */
  strands?: InputPipelines
  /** The per-light path's pipelines (`perLightPipelines.ts`), made at the first light that asks. */
  perLight?: PerLightPipelines
  /** The same of the `hair` cut: a pass that reads the strands' shadow on the surfaces. */
  perLightHair?: PerLightPipelines
}
/** The passes of one input type: the suns' group layout, pipeline layout and pipeline, and the local
 *  lights' pass for each format of the mask, with the group layout its mask is bound by. */
interface InputPipelines {
  sunsLayout: GPUBindGroupLayout
  sunsPipelineLayout: GPUPipelineLayout
  suns?: PreparedPipeline<GPUComputePipeline>
  /** The suns' pass of the `hair` cut: a pass that reads the strands' shadow on the surfaces (`VSM_PROJECTION_BINDING.hairShadow`), made at its first ask. */
  sunsHair?: LocalsPass
  locals: Map<string, LocalsPass>
}
export interface LocalsPass {
  groupLayout: GPUBindGroupLayout
  pipeline: PreparedPipeline<GPUComputePipeline>
}

/** The bindings the two passes' groups share: the view uniform, the scene's depth, normals and
 *  surface flags, the blue noise, the depth pyramid and the thin transmission. */
export const sharedEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(VSM_PROJECTION_BINDING.view),
  computeTextureEntry(VSM_PROJECTION_BINDING.sceneDepth, 'depth'),
  computeTextureEntry(VSM_PROJECTION_BINDING.normalRough, 'unfilterable-float'),
  computeTextureEntry(VSM_PROJECTION_BINDING.flags, 'uint'),
  computeTextureEntry(VSM_PROJECTION_BINDING.blueNoise, 'unfilterable-float'),
  ...hizDepthEntries(VSM_PROJECTION_BINDING.hizDepth, COMPUTE),
  computeStorageTextureEntry(VSM_PROJECTION_BINDING.subsurface, SUBSURFACE_FORMAT, 'read-only'),
  computeStorageTextureEntry(VSM_PROJECTION_BINDING.lobes, PHYSICAL_LOBES_FORMAT, 'read-only'),
]

/** The bindings the two passes' groups share over the hair strands: the view uniform, the depth of the
 *  nearest strand, the blue noise, the depth pyramid, the tiles' counts (a uniform) and their list. */
const strandsSharedEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(VSM_PROJECTION_BINDING.view),
  computeTextureEntry(VSM_PROJECTION_BINDING.sceneDepth, 'unfilterable-float'),
  computeTextureEntry(VSM_PROJECTION_BINDING.blueNoise, 'unfilterable-float'),
  ...hizDepthEntries(VSM_PROJECTION_BINDING.hizDepth, COMPUTE),
  computeUniformEntry(VSM_PROJECTION_BINDING.strandsCounts),
  computeBufferEntry(VSM_PROJECTION_BINDING.strandsTiles, 'read-only-storage'),
]

/** The bindings the two passes of `input` share. */
const sharedEntriesOf = (input: VsmInputType) =>
  input === 'strands' ? strandsSharedEntries() : sharedEntries()

/** The label of a pass's layout, group and pipeline of `input`: the surfaces' plain, the strands' marked. */
const inputLabel = (label: string, input: VsmInputType) =>
  input === 'strands' ? `${label}.strands` : label

/** The suns' pass group of `input`: the shared bindings, the suns' mask the pass writes and, where the
 *  set holds the prefiltered distant shadow (`prefiltered`), its merged pool. */
const sunsLayoutOf = (device: GPUDevice, prefiltered: boolean, input: VsmInputType, hair = false) =>
  device.createBindGroupLayout({
    label: inputLabel(hair ? 'vsm.projection.suns.hair' : 'vsm.projection.suns', input),
    entries: [
      ...sharedEntriesOf(input),
      computeStorageTextureEntry(
        VSM_PROJECTION_BINDING.mask,
        VSM_SUN_MASK_FORMAT,
        'write-only',
        '2d-array',
      ),
      ...(prefiltered
        ? [computeBufferEntry(VSM_PROJECTION_BINDING.filterableMerged, 'read-only-storage')]
        : []),
      ...(hair ? [hairShadowEntry()] : []),
    ],
  })

/** The layer array of the strands' shadow on the surfaces, a binding of the passes of the `hair` cut. */
export const hairShadowEntry = () =>
  computeTextureEntry(VSM_PROJECTION_BINDING.hairShadow, 'unfilterable-float', '2d-array')

/** The local lights' pass group of `input`: the shared bindings, the engine's deferred view, the lights
 *  and the light grid's lists the pass walks (the strands' reads its cells in the shadowed lights' grid
 *  alone), the shadowed lights' grid the marking pruned, and the mask it writes. */
const localsLayoutOf = (
  device: GPUDevice,
  format: MaskFormat,
  input: VsmInputType,
  capsule: boolean,
  hair: boolean,
) =>
  device.createBindGroupLayout({
    label: inputLabel(
      `vsm.projection.locals.${format}${capsule ? '.capsule' : ''}${hair ? '.hair' : ''}`,
      input,
    ),
    entries: [
      ...sharedEntriesOf(input),
      computeUniformEntry(VSM_PROJECTION_BINDING.deferredView),
      computeBufferEntry(VSM_PROJECTION_BINDING.directLights, 'read-only-storage'),
      ...(input === 'strands'
        ? []
        : [computeBufferEntry(VSM_PROJECTION_BINDING.tileLights, 'read-only-storage')]),
      computeBufferEntry(VSM_PROJECTION_BINDING.lightGrid, 'read-only-storage'),
      computeStorageTextureEntry(VSM_PROJECTION_BINDING.mask, format, 'write-only'),
      ...(capsule
        ? [computeTextureEntry(VSM_PROJECTION_BINDING.capsule, 'unfilterable-float', '2d-array')]
        : []),
      ...(hair ? [hairShadowEntry()] : []),
    ],
  })

/** The passes of `input` over the tables' group `vsmLayout`, for the pool `layout`: the suns' layouts
 *  made, the pipelines when asked. */
function inputPipelines(
  device: GPUDevice,
  vsmLayout: GPUBindGroupLayout,
  layout: VsmLayout,
  input: VsmInputType,
): InputPipelines {
  const sunsLayout = sunsLayoutOf(device, layout.prefilteredDistant, input)
  return {
    sunsLayout,
    sunsPipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [vsmLayout, sunsLayout] }),
    locals: new Map(),
  }
}

/** The projection's layouts and pipelines for the pool `layout`; its pipelines made when asked. */
function makePipelines(device: GPUDevice, layout: VsmLayout): Pipelines {
  const vsmLayout = device.createBindGroupLayout({
    label: 'vsm.projection.vsm',
    entries: vsmBindGroupLayoutEntries(VSM_PROJECTION_VSM_SPECS, COMPUTE),
  })
  return { device, layout, vsmLayout, ...inputPipelines(device, vsmLayout, layout, 'gbuffer') }
}

/** The passes of `p` for `input`, the strands' made at their first ask. */
export const passesOf = (p: Pipelines, input: VsmInputType): InputPipelines =>
  input === 'strands' ? (p.strands ??= inputPipelines(p.device, p.vsmLayout, p.layout, input)) : p

/** The suns' pass of `p` of the `hair` cut over the pixels of `input` (the group layout it is bound by and its pipeline), made at its first ask. */
export function sunsHairPass(p: Pipelines, input: VsmInputType = 'gbuffer'): LocalsPass {
  const passes = passesOf(p, input)
  if (passes.sunsHair) return passes.sunsHair
  const groupLayout = sunsLayoutOf(p.device, p.layout.prefilteredDistant, input, true)
  const label = `${inputLabel('vsm.projection.suns.hair', input)} (${nativeOrPolyfill(gpuCapsOf(p.device), 'subgroups').tag})`
  return (passes.sunsHair = {
    groupLayout,
    pipeline: preparedComputePipeline(p.device, {
      label: VSM_PROJECTION_PASS,
      layout: p.device.createPipelineLayout({ bindGroupLayouts: [p.vsmLayout, groupLayout] }),
      compute: {
        module: p.device.createShaderModule({
          label,
          code: vsmSunsProjectionWgsl(
            p.layout,
            hasSubgroupsOf(p.device, VSM_PROJECTION_HALF_LANES),
            input,
            true,
          ),
        }),
        entryPoint: 'vsmProjectSuns',
      },
    }),
  })
}

/** The suns' pipeline of `p` over the pixels of `input`, made at its first ask. */
export function sunsPipeline(p: Pipelines, input: VsmInputType = 'gbuffer') {
  const passes = passesOf(p, input)
  const label = `${inputLabel('vsm.projection.suns', input)} (${nativeOrPolyfill(gpuCapsOf(p.device), 'subgroups').tag})`
  return (passes.suns ??= preparedComputePipeline(p.device, {
    label: VSM_PROJECTION_PASS,
    layout: passes.sunsPipelineLayout,
    compute: {
      module: p.device.createShaderModule({
        label,
        code: vsmSunsProjectionWgsl(
          p.layout,
          hasSubgroupsOf(p.device, VSM_PROJECTION_HALF_LANES),
          input,
        ),
      }),
      entryPoint: 'vsmProjectSuns',
    },
  }))
}

/** The local lights' pipeline of `p` over the pixels of `input` writing a mask of `format`, made at its
 *  first ask. */
export function localsPipeline(
  p: Pipelines,
  format: MaskFormat,
  input: VsmInputType = 'gbuffer',
  capsule = false,
  hair = false,
) {
  const { locals } = passesOf(p, input)
  const key = `${format}${capsule ? ':capsule' : ''}${hair ? ':hair' : ''}`
  let pass = locals.get(key)
  if (!pass) {
    const groupLayout = localsLayoutOf(p.device, format, input, capsule, hair)
    const layout = p.device.createPipelineLayout({ bindGroupLayouts: [p.vsmLayout, groupLayout] })
    const label = `${inputLabel(`vsm.projection.locals.${key.replaceAll(':', '.')}`, input)} (${nativeOrPolyfill(gpuCapsOf(p.device), 'subgroups').tag})`
    const module = p.device.createShaderModule({
      label,
      code: vsmLocalsProjectionWgsl(
        p.layout,
        format,
        hasSubgroupsOf(p.device, VSM_PROJECTION_HALF_LANES),
        input,
        capsule,
        hair,
      ),
    })
    pass = {
      groupLayout,
      pipeline: preparedComputePipeline(p.device, {
        label: VSM_PROJECTION_PASS,
        layout,
        compute: { module, entryPoint: 'vsmProjectLocals' },
      }),
    }
    locals.set(key, pass)
  }
  return pass
}

/** The device's projections, by the pool layout they were compiled for (its row shift, and whether it holds
 *  the prefiltered distant shadow), made once a device. */
const projections = oncePerDevice((device: GPUDevice) =>
  preparedPipelines(
    (layout: VsmLayout) => makePipelines(device, layout),
    (layout) =>
      `${layout.poolRowShift}${layout.prefilteredDistant ? ':prefiltered' : ''}${layout.classic ? ':classic' : ''}`,
  ),
)

/** The projection of `device` for `layout` (`projections`). */
export const pipelinesFor = (device: GPUDevice, layout: VsmLayout) => projections(device).of(layout)

/** Group 0 of `p` over the tables of `res.current` (`vsmPerFrameSet`). */
export const tablesGroup = (res: VsmResources, p: Pipelines) =>
  vsmSpecGroup(p.device, p.vsmLayout, res, VSM_PROJECTION_VSM_SPECS, 'vsm.projection.vsm')

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
