/**
 * Host side of the virtual shadow map views' projection (`visualizeWgsl.ts`): which view the diagnostic mode asks for (`vsmVisualizeRequest`), the pipelines of the two kernels, and their
 * dispatch into the colour targets the screen pass (`../debug/visualizeView.ts`) draws. Run after the projection of the frame, over the same pixels, lights and tables, and only while a view
 * is on: the projection, its pipelines and its masks are the same with the view off.
 */
import type { DiagnosticMode } from '../../../../../../sdk-core/src/runtime/diagnostics.ts'
import { VIRTUAL_SHADOW_MAP_VIEWS } from '../../../../../../sdk-core/src/runtime/diagnostics.ts'
import { gpuCapsOf, nativeOrPolyfill } from '../../../../gpu/core/gpuCaps.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  namedEntries,
} from '../../../../gpu/core/computeBindings.ts'
import type { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { hasSubgroupsOf } from '../../../../gpu/core/subgroups.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { hizDepthBindEntries } from '../../../../visibility/hiz/gpu/pyramidTexture.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'
import {
  chainReady,
  preparedComputePipeline,
  type PreparedPipeline,
} from '../../../deferred/fullscreen.ts'
import { vsmBindGroupLayoutEntries, vsmSpecGroup, type VsmResources } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { sharedEntries } from './projectionPipelines.ts'
import { VSM_PROJECTION_BINDING, vsmProjectionGroups } from './projectionWgsl.ts'
import { VSM_PROJECTION_HALF_LANES } from './projectionPixelWgsl.ts'
import {
  projectsLocals,
  type VsmProjectionFrame,
  type VsmProjectionSource,
  type VsmProjectionTarget,
} from './projectionPass.ts'
import { vsmProjectionReserve, type VsmProjectionState } from './projectionStore.ts'
import {
  VSM_VISUALIZE_PARAM_WORDS,
  vsmVisualizeSpecs,
  vsmVisualizeLocalsWgsl,
  vsmVisualizePerLightWgsl,
  vsmVisualizeSunsWgsl,
} from './visualizeWgsl.ts'

/** The pass of the views' kernels. */
const VISUALIZE_PASS = `${VSM_PASS_PREFIX}visualize`
const VISUALIZE_STEP: GPUComputePassDescriptor = { label: VISUALIZE_PASS }
const VIEW_FORMAT: GPUTextureFormat = 'rgba16float'

/** What the diagnostic mode asks of the views: its mode id, the settings that shape it. */
export interface VsmVisualizeRequest {
  /** The mode id (`VIRTUAL_SHADOW_MAP_VIEWS`). */
  mode: number
  /** The record of the one light shown (`shadowVisualizeLightName`), −1 for every light. */
  light: number
  /** The kept pages only (`shadowVisualizeCachedPagesOnly`). */
  cachedOnly: boolean
  /** The overdraw view's scale, in percent (`shadowVisualizeOverdrawScale`). */
  overdrawScale: number
}

/** The record, among the frame's `lights`, of the light the name `name` picks: the first whose name is exactly it, else the first whose name contains it; −1 (every light) for the empty name or a name no light bears. */
export function visualizedLight(lights: readonly { readonly id: string }[], name: string) {
  if (!name) return -1
  const exact = lights.findIndex((light) => light.id === name)
  return exact >= 0 ? exact : lights.findIndex((light) => light.id.includes(name))
}

/** The request of the diagnostic `diagnostic` under the shadow settings `settings`, the frame's `lights` named by id; none while another view or none is on. */
export function vsmVisualizeRequest(
  diagnostic: DiagnosticMode | undefined,
  settings: {
    shadowVisualizeLightName: string
    shadowVisualizeCachedPagesOnly: boolean
    shadowVisualizeOverdrawScale: number
  },
  lights: readonly { readonly id: string }[],
): VsmVisualizeRequest | undefined {
  const mode = diagnostic && (VIRTUAL_SHADOW_MAP_VIEWS as Record<string, number>)[diagnostic]
  return mode
    ? {
        mode,
        light: visualizedLight(lights, settings.shadowVisualizeLightName),
        cachedOnly: settings.shadowVisualizeCachedPagesOnly,
        overdrawScale: settings.shadowVisualizeOverdrawScale,
      }
    : undefined
}

/** The two kernels of one pool layout, with the group layouts they are bound by. */
interface VisualizePipelines {
  vsmLayout: GPUBindGroupLayout
  sunsLayout: GPUBindGroupLayout
  localsLayout: GPUBindGroupLayout
  perLightLayout: GPUBindGroupLayout
  suns: PreparedPipeline<GPUComputePipeline>
  locals?: PreparedPipeline<GPUComputePipeline>
  perLight?: PreparedPipeline<GPUComputePipeline>
}

/** How the frame's local lights are shown: from the one-pass projection's grid (`grid`), or one by one (`each`, the per-light path); none without a local light. */
type VisualizeLocals = 'grid' | 'each' | undefined

/** The bindings of the suns' kernel: the projection's shared ones, the view's words and its colour target. */
const sunsEntries = () => [
  ...sharedEntries(),
  computeUniformEntry(VSM_PROJECTION_BINDING.visualize),
  computeStorageTextureEntry(VSM_PROJECTION_BINDING.visualizeOut, VIEW_FORMAT, 'write-only'),
]

/** The bindings of the per-light kernel: the suns' and the suns' colour. */
const perLightEntries = () => [
  ...sunsEntries(),
  computeTextureEntry(VSM_PROJECTION_BINDING.visualizeIn, 'unfilterable-float'),
]

/** The bindings of the local lights' kernel: the per-light kernel's, the engine's deferred view, the lights and the shadowed lights' grid. */
const localsEntries = () => [
  ...perLightEntries(),
  computeUniformEntry(VSM_PROJECTION_BINDING.deferredView),
  computeBufferEntry(VSM_PROJECTION_BINDING.directLights, 'read-only-storage'),
  computeBufferEntry(VSM_PROJECTION_BINDING.lightGrid, 'read-only-storage'),
]

function pipelineOf(
  device: GPUDevice,
  vsmLayout: GPUBindGroupLayout,
  groupLayout: GPUBindGroupLayout,
  module: GPUShaderModule,
  entryPoint: string,
) {
  return preparedComputePipeline(device, {
    label: VISUALIZE_PASS,
    layout: device.createPipelineLayout({ bindGroupLayouts: [vsmLayout, groupLayout] }),
    compute: { module, entryPoint },
  })
}

const pipelines = oncePerDevice(() => new WeakMap<VsmLayout, VisualizePipelines>())

/** The kernels for the pool `layout` of `device`, the local lights' (`locals`) compiled at the first ask. */
function pipelinesFor(device: GPUDevice, layout: VsmLayout, locals: VisualizeLocals) {
  const byLayout = pipelines(device)
  let made = byLayout.get(layout)
  if (made && (!locals || (locals === 'grid' ? made.locals : made.perLight))) return made
  const subgroups = hasSubgroupsOf(device, VSM_PROJECTION_HALF_LANES)
  const tag = nativeOrPolyfill(gpuCapsOf(device), 'subgroups').tag
  if (!made) {
    const vsmLayout = device.createBindGroupLayout({
      label: 'vsm.visualize.vsm',
      entries: vsmBindGroupLayoutEntries(vsmVisualizeSpecs(layout), COMPUTE),
    })
    const sunsLayout = device.createBindGroupLayout({
      label: 'vsm.visualize.suns',
      entries: sunsEntries(),
    })
    byLayout.set(
      layout,
      (made = {
        vsmLayout,
        sunsLayout,
        localsLayout: device.createBindGroupLayout({
          label: 'vsm.visualize.locals',
          entries: localsEntries(),
        }),
        perLightLayout: device.createBindGroupLayout({
          label: 'vsm.visualize.perLight',
          entries: perLightEntries(),
        }),
        suns: pipelineOf(
          device,
          vsmLayout,
          sunsLayout,
          device.createShaderModule({
            label: `vsm.visualize.suns (${tag})`,
            code: vsmVisualizeSunsWgsl(layout, subgroups),
          }),
          'vsmVisualizeSuns',
        ),
      }),
    )
  }
  if (locals === 'grid')
    made.locals = pipelineOf(
      device,
      made.vsmLayout,
      made.localsLayout,
      device.createShaderModule({
        label: `vsm.visualize.locals (${tag})`,
        code: vsmVisualizeLocalsWgsl(layout, subgroups),
      }),
      'vsmVisualizeLocals',
    )
  else if (locals === 'each')
    made.perLight = pipelineOf(
      device,
      made.vsmLayout,
      made.perLightLayout,
      device.createShaderModule({
        label: `vsm.visualize.perLight (${tag})`,
        code: vsmVisualizePerLightWgsl(layout, subgroups),
      }),
      'vsmVisualizeLocals',
    )
  return made
}

/** The views' state of `res`, if the views ever ran for it. */
export const vsmVisualizeStateOf = (res: VsmResources) => res.projection?.visualize

/** The views' state of the projection state `held`, made at its first ask, its targets of `width` × `height`. */
function stateOf(device: GPUDevice, held: VsmProjectionState, width: number, height: number) {
  const state = (held.visualize ??= {
    params: device.createBuffer({
      label: 'vsm.visualize.params',
      size: 4 * VSM_VISUALIZE_PARAM_WORDS,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    width: 0,
    height: 0,
  })
  if (state.width !== width || state.height !== height) {
    for (const texture of [state.suns, state.locals]) if (texture) retire(device, texture)
    const make = (label: string) =>
      device.createTexture({
        label,
        size: [width, height],
        format: VIEW_FORMAT,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      })
    state.suns = make('vsm.visualize.suns')
    state.locals = make('vsm.visualize.locals')
    state.width = width
    state.height = height
  }
  return state
}

/**
 * Draws the view `request` of the frame's lights: the suns' kernel into a colour target of the size of the projection's targets, then, where the frame has local lights, the local lights' kernel on top of
 * it — from the one-pass projection's grid (`projectsLocals`), else light by light as the per-light path projects them; what the screen pass draws is left in `vsmVisualizeStateOf(res).result`. Nothing is encoded while a pipeline compiles.
 */
export function encodeVsmVisualize(
  steps: ComputeRun,
  res: VsmResources,
  frame: VsmProjectionFrame,
  source: VsmProjectionSource,
  target: VsmProjectionTarget,
  request: VsmVisualizeRequest,
) {
  const { device, width, height } = frame
  const projection = vsmProjectionReserve(device, res)
  const locals: VisualizeLocals = projectsLocals(frame.lights, source, target)
    ? 'grid'
    : frame.lights.length > 0 && frame.lights[frame.lights.length - 1].type !== 'directional'
      ? 'each'
      : undefined
  const p = pipelinesFor(device, res.layout, locals)
  // What an earlier view drew is not this one's: nothing is shown until this frame's kernels ran.
  if (projection.visualize) projection.visualize.result = undefined
  if (!chainReady(p.suns, locals === 'grid' ? p.locals : locals && p.perLight)) return
  const state = stateOf(device, projection, width, height)
  // The words of the views' uniform (`VSM_VISUALIZE_PARAM_WORDS`): the last is the overdraw scale, a float.
  const words = new Uint32Array([request.mode, request.light, request.cachedOnly ? 1 : 0, 0])
  new Float32Array(words.buffer)[3] = request.overdrawScale
  device.queue.writeBuffer(state.params, 0, words)
  const pass = steps.pass(VISUALIZE_STEP)
  pass.setBindGroup(
    0,
    vsmSpecGroup(device, p.vsmLayout, res, vsmVisualizeSpecs(res.layout), 'vsm.visualize.vsm'),
  )
  const shared = {
    view: { buffer: projection.uniform! },
    sceneDepth: source.depth,
    normalRough: source.normalRough,
    flags: source.flags,
    blueNoise: projection.blueNoiseView!,
    subsurface: source.subsurface,
    lobes: source.lobes,
    visualize: { buffer: state.params },
  }
  const hiz = hizDepthBindEntries(VSM_PROJECTION_BINDING.hizDepth, frame.hizDepth)
  pass.setPipeline(p.suns.get()!)
  pass.setBindGroup(
    1,
    device.createBindGroup({
      label: 'vsm.visualize.suns',
      layout: p.sunsLayout,
      entries: [
        ...namedEntries(VSM_PROJECTION_BINDING, {
          ...shared,
          visualizeOut: state.suns!.createView(),
        }),
        ...hiz,
      ],
    }),
  )
  const groups = [vsmProjectionGroups(width), vsmProjectionGroups(height), 1] as const
  pass.dispatchWorkgroups(...groups)
  let shown = state.suns!
  if (locals) {
    const grid = locals === 'grid'
    pass.setPipeline((grid ? p.locals : p.perLight)!.get()!)
    pass.setBindGroup(
      1,
      device.createBindGroup({
        label: `vsm.visualize.${grid ? 'locals' : 'perLight'}`,
        layout: grid ? p.localsLayout : p.perLightLayout,
        entries: [
          ...namedEntries(VSM_PROJECTION_BINDING, {
            ...shared,
            visualizeIn: state.suns!.createView(),
            visualizeOut: state.locals!.createView(),
            ...(grid && {
              deferredView: { buffer: source.deferredView! },
              directLights: { buffer: source.directLights! },
              lightGrid: { buffer: target.lightGrid! },
            }),
          }),
          ...hiz,
        ],
      }),
    )
    pass.dispatchWorkgroups(...groups)
    shown = state.locals!
  }
  state.result = { view: shown.createView(), request }
}
