import {
  heldMakerOf,
  NO_SCENE_MASKS,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import {
  reflectionHitLayout,
  reflectionLayout,
  reflectionTraceModule,
} from '../reflectionPipelines.ts'
import {
  hardwareFinishLayout,
  hardwareFinishSceneLayout,
  hardwareLitLayout,
  hardwareMaskedTraceLayout,
} from '../trace/traceBindings.ts'
import { SORT_BINDINGS, SORT_TRACES_WGSL } from '../translucency/sortWgsl.ts'
import type { LitListKernels, LitListResources } from './listPasses.ts'
import { LIT_COMPACT_BINDINGS as C, LIT_MATERIAL_FORMAT, litCompactProgram } from './litWgsl.ts'

const SORT_ENTRIES = ['sortTracesByMaterial'] as const

/**
 * The layouts of the compaction's entries, each binding what it reads or writes alone: the pass that is dispatched from `args` (the sort, the copy, the two lit passes) never has it bound as storage,
 * a buffer being refused as an indirect argument and a writable storage binding of one dispatch.
 */
const compactLayoutOf = (device: GPUDevice, label: string, entries: GPUBindGroupLayoutEntry[]) =>
  device.createBindGroupLayout({ label: `Trillion3D reflection hit lighting ${label}`, entries })

/** The layout of `litCompact`'s group 0: its parameters, the rays missed, the hits, the list it fills and the materials' texture. */
export const litCompactLayout = oncePerDevice((device: GPUDevice) =>
  compactLayoutOf(device, 'compaction', [
    computeUniformEntry(C.params),
    computeBufferEntry(C.pending, 'read-only-storage'),
    computeBufferEntry(C.hits, 'read-only-storage'),
    computeBufferEntry(C.list, 'storage'),
    computeStorageTextureEntry(C.materials, LIT_MATERIAL_FORMAT, 'write-only'),
  ]),
)

/** The layout of `litDispatch`'s group 0: the list it counts and the arguments it writes. */
export const litDispatchLayout = oncePerDevice((device: GPUDevice) =>
  compactLayoutOf(device, 'dispatch', [
    computeBufferEntry(C.list, 'storage'),
    computeBufferEntry(C.args, 'storage'),
  ]),
)

/** The layout of `litCopy`'s group 0: the list it hands on and the sorted copy it fills. */
export const litCopyLayout = oncePerDevice((device: GPUDevice) =>
  compactLayoutOf(device, 'copy', [
    computeBufferEntry(C.list, 'storage'),
    computeBufferEntry(C.sorted, 'storage'),
  ]),
)

/** The layout of the sort's arguments entry (`sortTracesArgs`): the list it counts and the arguments it writes. */
export const litSortArgsLayout = oncePerDevice((device: GPUDevice) =>
  compactLayoutOf(device, 'sort arguments', [
    computeBufferEntry(SORT_BINDINGS.traces, 'read-only-storage'),
    computeBufferEntry(SORT_BINDINGS.args, 'storage'),
  ]),
)

/** The layout of the sort (`sortTracesByMaterial`): the list, the sorted copy it fills and the materials' texture. */
export const litSortLayout = oncePerDevice((device: GPUDevice) =>
  compactLayoutOf(device, 'sort', [
    computeBufferEntry(SORT_BINDINGS.traces, 'read-only-storage'),
    computeBufferEntry(SORT_BINDINGS.sorted, 'storage'),
    computeTextureEntry(SORT_BINDINGS.materials, 'uint'),
  ]),
)

/** The module of the compaction's entries (`litCompactProgram`): its code never changes, so a device compiles it once for every host, format and set of graph masks. */
const litCompactModule = oncePerDevice((device: GPUDevice) =>
  device.createShaderModule({ label: 'Trillion3D hit lighting list', code: litCompactProgram() }),
)

/**
 * The stages that work on a list of traces to light, whatever the host that filled it: the arguments of the passes that follow, the unsorted hand-over, and the sort by material (`sortWgsl.ts`) with its arguments.
 * `litCompactModule` holds the first two, the sort's module is made here. Each reads or writes the buffers of its own layout alone. Their code and layouts never change: a device compiles them once, for every host, format and set of graph masks.
 */
export const litListStages = oncePerDevice((device: GPUDevice) => {
  const label = 'Trillion3D hit lighting list'
  const compactModule = litCompactModule(device)
  const stages = (
    name: string,
    layout: GPUBindGroupLayout,
    module: GPUShaderModule,
    entry: string,
  ) =>
    startedComputeStages(
      device,
      `${label} ${name}`,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      module,
      [entry],
    )
  const sortModule = device.createShaderModule({ label: `${label} sort`, code: SORT_TRACES_WGSL })
  const dispatch = stages('dispatch', litDispatchLayout(device), compactModule, 'litDispatch')
  const copy = stages('copy', litCopyLayout(device), compactModule, 'litCopy')
  const sortArgs = stages('sort arguments', litSortArgsLayout(device), sortModule, 'sortTracesArgs')
  const sort = stages('sort', litSortLayout(device), sortModule, SORT_ENTRIES[0])
  return {
    all: [dispatch, copy, sortArgs, sort],
    get dispatch() {
      return dispatch.pipelineOf('litDispatch')
    },
    get copy() {
      return copy.pipelineOf('litCopy')
    },
    get sortArgs() {
      return sortArgs.pipelineOf('sortTracesArgs')
    },
    get sort() {
      return sort.pipelineOf('sortTracesByMaterial')
    },
  }
})

/** The layout of a host's pass, made once a device: group 0 of the pass named `label` for the host `host`, from `entries`. */
export const litHostLayoutOf = (
  host: string,
  label: string,
  entries: () => GPUBindGroupLayoutEntry[],
) =>
  oncePerDevice((device: GPUDevice) =>
    device.createBindGroupLayout({
      label: `Trillion3D ${host} hit lighting ${label}`,
      entries: entries(),
    }),
  )

/** One pass of a host's hit lighting: its bind group layouts, the text of its module and the entries compiled from it. */
export interface LitHostPass<E extends string = string> {
  readonly name: string
  readonly layouts: GPUBindGroupLayout[]
  readonly module: GPUShaderModule
  readonly entries: readonly E[]
  readonly constants?: Record<string, number>
}

/** The stages of a pass already compiled, which a host that shares a pass between its kernel sets hands in place of the pass. */
export type LitHostStages<E extends string = string> = ReturnType<typeof startedComputeStages<E>>

/**
 * THE PASSES OF A HOST'S HIT LIGHTING over a list of the hits to light, compiled together off the frame: the host's compaction, `litListStages` (the arguments, the unsorted hand-over, the sort by material), the host's first pass and its second. The stages are
 * read through `pipelineOf` once `ready`.
 */
export function litListKernels<C extends string, D extends string, F extends string>(
  device: GPUDevice,
  label: string,
  passes: {
    compact: LitHostPass<C> | LitHostStages<C>
    direct: LitHostPass<D> | LitHostStages<D>
    finish: LitHostPass<F> | LitHostStages<F>
  },
) {
  const stage = <E extends string>(p: LitHostPass<E> | LitHostStages<E>) =>
    'module' in p
      ? startedComputeStages(
          device,
          `${label} ${p.name}`,
          device.createPipelineLayout({ bindGroupLayouts: p.layouts }),
          p.module,
          p.entries,
          p.constants,
        )
      : p
  const compact = stage(passes.compact)
  const list = litListStages(device)
  const direct = stage(passes.direct)
  const finish = stage(passes.finish)
  const all = [compact, ...list.all, direct, finish]
  return {
    compact,
    list,
    direct,
    finish,
    get ready() {
      return all.every((s) => s.ready)
    },
    get pending() {
      return all.some((s) => s.pending)
    },
  }
}

/**
 * The bind groups of the list's passes over `lit`'s buffers (`litListStages`): the arguments of the dispatch, the unsorted hand-over and the sort with its arguments, which reads the material key of each entry's texel in `materials`.
 */
export function litListGroups(
  device: GPUDevice,
  lit: Pick<LitListResources, 'list' | 'sorted' | 'args'>,
  materials: GPUBindingResource,
) {
  const group = (layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) =>
    device.createBindGroup({ layout, entries })
  const listed = (binding: number, buffer: GPUBuffer) => ({ binding, resource: { buffer } })
  return {
    dispatch: group(litDispatchLayout(device), [
      listed(C.list, lit.list),
      listed(C.args, lit.args),
    ]),
    copy: group(litCopyLayout(device), [listed(C.list, lit.list), listed(C.sorted, lit.sorted)]),
    sortArgs: group(litSortArgsLayout(device), [
      listed(SORT_BINDINGS.traces, lit.list),
      listed(SORT_BINDINGS.args, lit.args),
    ]),
    sort: group(litSortLayout(device), [
      listed(SORT_BINDINGS.traces, lit.list),
      listed(SORT_BINDINGS.sorted, lit.sorted),
      { binding: SORT_BINDINGS.materials, resource: materials },
    ]),
  }
}

/** The reflections' compaction (`litCompact`): its code and layout never change, a device compiles it once. */
const reflectionCompact = oncePerDevice((device: GPUDevice) =>
  startedComputeStages(
    device,
    'Trillion3D reflection hit lighting compaction',
    device.createPipelineLayout({ bindGroupLayouts: [litCompactLayout(device)] }),
    litCompactModule(device),
    ['litCompact'],
  ),
)

/**
 * The hit lighting's kernels, compiled off the frame and not waited for by the reflections' own (`ready`): the compaction, the dispatch's arguments and the unsorted hand-over, the sort by
 * material, the first pass (the module of the hardware trace that holds the hit lighting, `reflectionTraceModule`'s `direct`, over its hit group) and the second (the program that reads the cache's indirect light, over the answer's group), each of the surface `layer`.
 */
const kernelsOver = oncePerDeviceOverPrograms(
  (device: GPUDevice, light: LightAtlasFormat, programs) => {
    const label = `Trillion3D reflection hit lighting ${sceneMaskKey(programs)}`
    const compact = reflectionCompact(device)
    const list = litListStages(device)
    const direct = reflectionTraceModule(device, light, programs, 'direct')
    const finish = reflectionTraceModule(device, light, programs, 'finish')
    const passes = [0, 1].map((layer) => ({
      direct: startedComputeStages(
        device,
        `${label} direct ${layer}`,
        device.createPipelineLayout({
          bindGroupLayouts: [
            hardwareLitLayout(device),
            reflectionHitLayout(device),
            hardwareMaskedTraceLayout(device),
          ],
        }),
        direct,
        ['litDirect'],
        { REFLECTION_LAYER: layer },
      ),
      finish: startedComputeStages(
        device,
        `${label} finish ${layer}`,
        device.createPipelineLayout({
          bindGroupLayouts: [
            hardwareFinishLayout(device, light),
            reflectionLayout(device),
            hardwareFinishSceneLayout(device),
          ],
        }),
        finish,
        ['litFinish'],
        { REFLECTION_LAYER: layer },
      ),
    }))
    const all = [compact, ...list.all, ...passes.flatMap((p) => [p.direct, p.finish])]
    const layers: LitListKernels[] = passes.map((p) => ({
      get compact() {
        return compact.pipelineOf('litCompact')
      },
      list,
      get direct() {
        return p.direct.pipelineOf('litDirect')
      },
      get finish() {
        return p.finish.pipelineOf('litFinish')
      },
    }))
    return {
      light,
      get ready() {
        return all.every((stage) => stage.ready)
      },
      get pending() {
        return all.some((stage) => stage.pending)
      },
      // The pipelines of a surface's `layer`, read once `ready`: the object is cached with the device before the stages are compiled.
      layer: (layer: number) => layers[layer]!,
    }
  },
)

/** The hit lighting's kernels over the graph masks `programs` the rays cut the surfaces by. */
export const hitLightingKernels = (
  device: GPUDevice,
  light: LightAtlasFormat,
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
) => kernelsOver(device, light, programs)

/** The maker of the kernels for a format of the cache's light, as the mask hold takes it (`maskHold.use`): one function a device and format, not one an image. */
export const hitLightingMaker = heldMakerOf(kernelsOver)
