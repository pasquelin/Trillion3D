import { shadeLayout, shadeOutputLayout } from './shadeLayout.ts'
import { scoped } from './pipelines.ts'
import {
  preparedComputePipeline,
  type PreparedPipeline,
} from '../../lighting/deferred/fullscreen.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import {
  DIAGNOSTIC_SHADE_WGSL,
  shadeVariantEntry,
  variesShade,
} from '../../diagnostic/gpuGeometry.ts'
import { CLASS_FEATURE } from '../shader/classWords.ts'
import { shadeShader } from '../shader/shadeWgsl.ts'
import { shadeWpo } from '../shader/wpoSets.ts'
import { wpoKey } from '../../materials/graph/wpoProgram.ts'
import { NO_RASTERS, type GraphRasters } from '../../materials/graph/graphRasters.ts'
import {
  classIdentity,
  graphClassOf,
  type GraphClass,
} from '../../materials/graph/surfaceClasses.ts'
import type { DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import { feedbackConstants } from '../../materials/virtual/requestWgsl.ts'
import { displacedShadeLayout } from '../tessellation/prismFrame.ts'

/** The resolve's class pipelines: one per class key (`../shader/materialClass.ts`),
 *  prepared before the image that shades the class (`PreparedPipeline`), never by it. */
export type ShadeClasses = {
  /** The pipeline of class `key`. */
  of(key: number): PreparedPipeline<GPUComputePipeline>
  /** The pipeline of class `key` for the displaced pixels its rows draw: its resolve places a pixel
   *  on the displaced triangle (`../tessellation/prismWgsl.ts`), over a group 0 that adds the
   *  depth and the view's numbers (`displacedShadeLayout`). Made when a scene tessellates one. */
  displaced(key: number): PreparedPipeline<GPUComputePipeline>
  /** The classes made so far: those of the census, and those asked since. */
  keys(): Iterable<number>
  /** Lets go of the pipelines of the keys of the graphs' classes that another class took. */
  prune(): void
  /** The same classes writing the layer, made once — itself when it writes it: what a scene whose
   *  surface came to emit or occlude switches to once they are compiled
   *  (`../../frame/loop/framePipelines.ts`). */
  withEmissiveAo(): ShadeClasses
  /** The same classes for the capture of the surface cache's cards, made once — itself when it is
   *  one: each row is placed by the view of its own (`CARD_VIEWS`), and the layer is written. The
   *  main view's sets fold that read away. */
  cards(): ShadeClasses
  /** The same classes compiled to stop at diagnostic stage `stage` of the shading kernel
   *  (`SHADE_STAGE`, `../shader/shadeEntryWgsl.ts`), made once — itself at 0. */
  staged(stage: number): ShadeClasses
}

/** The pipelines a set of classes holds, plain and displaced: what says which programs are worn. */
type ClassSets = { set: { keys(): Iterable<number> }; displaced: { keys(): Iterable<number> } }

/** The text keys of the graph programs whose classes stand in `sets`. */
function liveProgramKeys(sets: readonly ClassSets[]) {
  const live = new Set<string>()
  for (const { set, displaced } of sets)
    for (const keys of [set.keys(), displaced.keys()])
      for (const key of keys) {
        const graph = graphClassOf(key)
        if (graph) live.add(graph.program.compiled.key)
      }
  return live
}

/** The modules a class's resolve is made over, each made the first time one is asked, so that a scene
 *  without the kind compiles what it did before: the shared one (`shadeModule`); a voxel class's
 *  own (`shadeShader`'s voxel text); a displaced class's, with the layout of its own group 0 —
 *  the resolve's, plus the depth and the view's numbers —; and the module of each program of a
 *  graph, plain or displaced (`graphModule`), which every class of that program shares, holding the
 *  offset of that program alone if the session holds it (`rasters`): a pixel of the class wears no
 *  other. */
function classModules(
  device: GPUDevice,
  shadeModule: GPUShaderModule,
  variant: DiagnosticGpuVariant | undefined,
  rasters: () => GraphRasters,
) {
  const diagnostic = () => (variesShade(variant) ? { diagnostic: DIAGNOSTIC_SHADE_WGSL } : {})
  let voxelModule: GPUShaderModule | undefined
  let displacedModule: GPUShaderModule | undefined, displacedLayout: GPUPipelineLayout | undefined
  // By the program's text, then by what the module is made with: displaced or not, the offsets held.
  const graphModules = new Map<string, Map<string, GPUShaderModule>>()
  const graphModule = (graph: GraphClass, displaced: boolean) => {
    const { compiled } = graph.program
    const wpo = shadeWpo(rasters(), graph.program)
    const id = `${displaced}|${wpoKey(wpo)}`
    let made = graphModules.get(compiled.key)
    if (!made) graphModules.set(compiled.key, (made = new Map()))
    let module = made.get(id)
    if (!module)
      made.set(
        id,
        (module = device.createShaderModule({
          code: shadeShader({ graph: compiled, displaced, wpo, ...diagnostic() }),
        })),
      )
    return module
  }
  return {
    moduleOf: (key: number, graph?: GraphClass) =>
      graph
        ? graphModule(graph, false)
        : (key & CLASS_FEATURE.VOXEL) === 0
          ? shadeModule
          : (voxelModule ??= device.createShaderModule({
              code: shadeShader({ voxel: true, ...diagnostic() }),
            })),
    displacedParts: (graph?: GraphClass) => ({
      layout: (displacedLayout ??= device.createPipelineLayout({
        bindGroupLayouts: [displacedShadeLayout(device), shadeOutputLayout(device)],
      })),
      module: graph
        ? graphModule(graph, true)
        : (displacedModule ??= device.createShaderModule({
            code: shadeShader({ displaced: true, ...diagnostic() }),
          })),
    }),
    /** Lets go of the modules of the programs `live` does not name (their text's key). */
    keep(live: ReadonlySet<string>) {
      for (const key of graphModules.keys()) if (!live.has(key)) graphModules.delete(key)
    },
  }
}

/** The sets of class pipelines over `layout` and the modules of `modules`, writing the emission layer
 *  or not: one entry with the feedback target or without it, its request folded by `FEEDBACK`. */
function classSetsOf(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  variant: DiagnosticGpuVariant | undefined,
  feedback: boolean,
  { moduleOf, displacedParts, keep }: ReturnType<typeof classModules>,
) {
  const entryPoint = shadeVariantEntry(variant)
  const fed = feedbackConstants(feedback)
  /** Class features derive from the key; the layer's store is folded away without it. */
  const shadeDescriptor = (
    key: number,
    layer: boolean,
    cards: boolean,
    stage: number,
    displaced = false,
  ): GPUComputePipelineDescriptor => {
    // A class of a graph's program holds the features its rows are worn on (`CLASS_KEY`) and is
    // binned under its own key (`CLASS_BIN`).
    const graph = graphClassOf(key)
    const constants: Record<string, number> = { CLASS_KEY: graph?.features ?? key, ...fed }
    if (graph) constants.CLASS_BIN = key
    if (!layer) constants.EMISSIVE_AO = 0
    if (cards) constants.CARD_VIEWS = 1
    if (stage) constants.SHADE_STAGE = stage
    const { layout: used, module } = displaced
      ? displacedParts(graph)
      : { layout, module: moduleOf(key, graph) }
    return { layout: used, compute: { module, entryPoint, constants } }
  }
  const made: ClassSets[] = []
  // The capture's twin, one for the plain set and the layered one alike.
  let cardSet: ShadeClasses | undefined
  const classSet = (layer: boolean, cards = false, stage = 0): ShadeClasses => {
    // A key a class released is taken by another: its pipelines are those of the class it stands for.
    const set = preparedPipelines(
      (key: number) => preparedComputePipeline(device, shadeDescriptor(key, layer, cards, stage)),
      classIdentity,
    )
    const displaced = preparedPipelines(
      (key: number) =>
        preparedComputePipeline(device, shadeDescriptor(key, layer, cards, stage, true)),
      classIdentity,
    )
    let layered: ShadeClasses | undefined
    const stages = new Map<number, ShadeClasses>()
    const shade: ShadeClasses = {
      ...set,
      displaced: displaced.of,
      prune() {
        const current = (key: number, id: unknown) => classIdentity(key) === id
        set.prune(current)
        displaced.prune(current)
        layered?.prune()
        cardSet?.prune()
        for (const twin of stages.values()) twin.prune()
        // A released class takes its program's modules with it, unless another class of the program
        // stands in a set (the layered twin's too).
        keep(liveProgramKeys(made))
      },
      withEmissiveAo: () => (layer ? shade : (layered ??= classSet(true, false, stage))),
      cards: () => (cards ? shade : (cardSet ??= classSet(true, true))),
      staged: (at) => {
        if (at === stage) return shade
        let twin = stages.get(at)
        if (!twin) stages.set(at, (twin = classSet(layer, cards, at)))
        return twin
      },
    }
    made.push({ set, displaced })
    return shade
  }
  return classSet
}

/** Builds the class-specialized material pipelines during preparation: each a compute stage that
 *  shades the pixels of its class's bin, one indirect dispatch an image
 *  (`../../materials/classes/shadeBins.ts`). Without `emissiveAo`, the emission-and-occlusion target
 *  is left as it was cleared and its mark never set (`EMISSIVE_AO`,
 *  `../../materials/surface/surfaceEmission.ts`). The census's classes compile here, together; one a
 *  material changed into since is asked before the image that shades it. `rasters` reads the graph
 *  outputs the session holds (`WebgpuVisState.rasters`) when a class's module is made. */
export function createWebgpuShadePipelines(
  device: GPUDevice,
  shadeModule: GPUShaderModule,
  classes: readonly number[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
  emissiveAo = true,
  rasters: () => GraphRasters = () => NO_RASTERS,
) {
  return scoped(device, async () => {
    const shadeBindGroupLayout = sharedLayout ?? shadeLayout(device)
    const layout = device.createPipelineLayout({
      bindGroupLayouts: [shadeBindGroupLayout, shadeOutputLayout(device)],
    })
    const modules = classModules(device, shadeModule, variant, rasters)
    const shadeClasses = classSetsOf(device, layout, variant, feedback, modules)(emissiveAo)
    await Promise.all(classes.map((key) => shadeClasses.of(key).prepare()))
    return { shadeBindGroupLayout, shadeClasses }
  })
}
