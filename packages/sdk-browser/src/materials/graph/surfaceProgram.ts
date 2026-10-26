import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import type { GraphBlend } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { TILE_REQUEST_WGSL } from '../virtual/requestWgsl.ts'
import { COLOR_SAMPLE_WGSL } from '../virtual/wgsl.ts'
import { compileGraph, readingKey, type CompileOptions, type CompiledGraph } from './compile.ts'
import { compileKept, isRefusal, type GraphRefusal } from './kept.ts'

/**
 * A SURFACE'S GRAPH COMPILED for the pass that shades it: the opaque resolve (`resolve`; its mask is
 * the raster's, which reads no graph) or the transparent pass (`blend`, which reads the opacity it
 * blends by). Neither finds a texture read's footprint by a derivative the graph's own coordinate
 * has — a compute pass has none, a fragment program takes its derivative where its quad is uniform —:
 * the coordinate is evaluated again at the pixels beside (`derivatives: 'neighbours'`), their
 * contexts filled by the pass (the pixel's weights, or the screen derivatives of its context), and the
 * tiles the textures take are asked of the feedback. Each program is known by an `id`, one for each
 * distinct program of its kind, which the surface's values carry (`../table/graphRecord.ts`) for the
 * transparent pass's one module to choose its functions by.
 */
export type ProgramKind = 'resolve' | 'blend'

export interface SurfaceProgram {
  readonly kind: ProgramKind
  readonly compiled: CompiledGraph
  readonly graph: MaterialGraph
  /** Tells the program from another of its kind, from 1: kept for as long as the page lives. */
  readonly id: number
}

/** What a surface says of how its graph is compiled: its blend, whether it transmits, whether it is
 *  lit and whether its emission may be negative. */
export interface GraphSurface {
  readonly graph?: MaterialGraph
  readonly transparent?: boolean
  readonly transmission?: number
  readonly water?: boolean
  readonly lit?: boolean
  readonly allowNegativeEmissive?: boolean
  /** Whether its graph's `shadingModel` output decides its pixels' model (the material says `fromMaterialExpression`); unsaid, it does. */
  readonly modelFromGraph?: boolean
}

type Entry = SurfaceProgram | GraphRefusal
/** The distinct programs of each kind, by the whole text they compile to (`CompiledGraph.key`: no
 *  collision of a hash can make two of one), the first of each kept. */
const ids = { resolve: new Map<string, number>(), blend: new Map<string, number>() }
const known = { resolve: [] as SurfaceProgram[], blend: [] as SurfaceProgram[] }

/** Whether `entry` is a program, not a refusal. */
export const isProgram = (entry: Entry | undefined): entry is SurfaceProgram =>
  !!entry && !isRefusal(entry)

/** Which pass shades `surface`: the transparent pass for a blended surface or one that transmits
 *  (`blendedSurface`, `../table/materialSummary.ts`), the opaque resolve otherwise. */
const kindOf = (
  surface: Pick<GraphSurface, 'transparent' | 'transmission' | 'water'>,
): ProgramKind =>
  surface.transparent || (surface.transmission ?? 0) > 0 || surface.water ? 'blend' : 'resolve'

/** The blend a surface's graph is read under: the opacity only where it blends (`alphaModeOf`), the
 *  mask only where the opaque resolve's surface wires one — it is then a masked surface, cut by the
 *  rasters (`maskProgram.ts`). */
const blendOf = (surface: GraphSurface, kind: ProgramKind): GraphBlend => {
  if (kind === 'blend') return surface.transparent ? 'blend' : 'opaque'
  return surface.graph?.outputs.opacityMask ? 'mask' : 'opaque'
}

/** The id of the program `key` of `kind`, taken at the first ask. */
function idOf(kind: ProgramKind, key: string, make: (id: number) => SurfaceProgram) {
  let id = ids[kind].get(key)
  if (id) return known[kind][id - 1]
  id = known[kind].length + 1
  ids[kind].set(key, id)
  known[kind].push(make(id))
  return known[kind][id - 1]
}

/** How a surface's graph is compiled besides the pass: what its surface says (`GraphSurface`). */
type Reading = Required<
  Pick<CompileOptions, 'blend' | 'lit' | 'translucent' | 'negativeEmissive' | 'modelFromGraph'>
>

/** The graph compiled for `kind`, once: in the transparent pass its declarations are named by the
 *  text's own hash, so that the programs of one module are apart. */
function compileFor(graph: MaterialGraph, kind: ProgramKind, reading: Reading): Entry {
  const options: CompileOptions = {
    sample: COLOR_SAMPLE_WGSL,
    derivatives: 'neighbours',
    request: TILE_REQUEST_WGSL,
    ...reading,
    named: kind === 'blend',
    // The resolve and the offset carry the vertex colour (`shadeGraphWgsl.ts`, `wpoGraphWgsl.ts`); the
    // transparent pass's fragment has no varying for it (`../../blend/vertexWgsl.ts`).
    vertexColor: kind === 'resolve',
  }
  const compiled = compileGraph(graph, options)
  // The values are this graph's; the program is the first graph's of the same text.
  const shared = idOf(kind, compiled.key, (id) => ({ kind, compiled, graph, id }))
  return { kind, compiled, graph, id: shared.id }
}

/**
 * The program a surface's graph compiles to for `kind` — the pass that shades it, `kindOf` by
 * default —, once for each shape of the graph — a value written to a parameter compiles nothing
 * again —; none for a surface with no graph; a refusal, naming the node, for a graph that does not
 * compile. A program is the one every graph of the same text shares.
 */
export function programOf(surface: GraphSurface, kind = kindOf(surface)): Entry | undefined {
  const { graph } = surface
  if (!graph) return undefined
  const reading: Reading = {
    blend: blendOf(surface, kind),
    lit: surface.lit !== false,
    translucent: kind === 'blend',
    negativeEmissive: surface.allowNegativeEmissive === true,
    modelFromGraph: surface.modelFromGraph !== false,
  }
  const key = `${kind}:${reading.blend}:${readingKey(reading)}`
  return compileKept(graph, key, () => compileFor(graph, kind, reading))
}

/** The programs of `kind` among those known, by id: what a module of the transparent pass holds the
 *  functions of. */
export const programsOf = (kind: ProgramKind): readonly SurfaceProgram[] => known[kind]
