import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import type { GraphBlend } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { TILE_REQUEST_WGSL } from '../virtual/requestWgsl.ts'
import { COLOR_SAMPLE_WGSL } from '../virtual/wgsl.ts'
import { compileGraph, type CompileOptions, type CompiledGraph } from './compile.ts'

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

/** A graph the pass could not compile, with the error's words: its surface is drawn from its
 *  parameters, as a surface with no graph is. */
export interface GraphRefusal {
  readonly error: string
}

/** What a surface says of how its graph is compiled: its blend, and whether it transmits. */
export interface GraphSurface {
  readonly graph?: MaterialGraph
  readonly transparent: boolean
  readonly alphaTest: number
  readonly transmission?: number
}

type Entry = SurfaceProgram | GraphRefusal
/** What was compiled of a graph, by kind, and the shape and blend it was compiled at. */
const kept = new WeakMap<MaterialGraph, Map<string, { shape: number; entry: Entry }>>()
/** The distinct programs of each kind, by the text they compile to (`ids`), the first of each kept. */
const ids = { resolve: new Map<string, number>(), blend: new Map<string, number>() }
const known = { resolve: [] as SurfaceProgram[], blend: [] as SurfaceProgram[] }
/** The refusals made since they were last taken, once each (`takeGraphRefusals`). */
const refused: string[] = []

/** Whether `entry` is a program, not a refusal. */
export const isProgram = (entry: Entry | undefined): entry is SurfaceProgram =>
  !!entry && 'compiled' in entry

/** Which pass shades `surface`: the transparent pass for a blended surface or one that transmits
 *  (`blendedSurface`, `../table/materialSummary.ts`), the opaque resolve otherwise. */
export const kindOf = (surface: Pick<GraphSurface, 'transparent' | 'transmission'>): ProgramKind =>
  surface.transparent || (surface.transmission ?? 0) > 0 ? 'blend' : 'resolve'

/** The blend a surface's graph is read under: the opacity only where it blends (`alphaModeOf`). */
const blendOf = (surface: GraphSurface, kind: ProgramKind): GraphBlend =>
  kind === 'blend' && surface.transparent ? 'blend' : 'opaque'

/** The graph compiled for `kind`; in the transparent pass its declarations are named by the text's
 *  own hash, so that the programs of one module are apart. */
function compileFor(graph: MaterialGraph, kind: ProgramKind, blend: GraphBlend) {
  const options: CompileOptions = {
    sample: COLOR_SAMPLE_WGSL,
    derivatives: 'neighbours',
    request: TILE_REQUEST_WGSL,
    blend,
  }
  const plain = compileGraph(graph, options)
  if (kind === 'resolve') return { compiled: plain, key: plain.hash }
  return {
    compiled: compileGraph(graph, { ...options, suffix: `_${plain.hash}` }),
    key: plain.hash,
  }
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

/**
 * The program a surface's graph compiles to for `kind` — the pass that shades it, `kindOf` by
 * default —, once for each shape of the graph — a value written to a parameter compiles nothing
 * again —; none for a surface with no graph; a refusal, naming the node, for a graph that does not
 * compile. A program is the one every graph of the same text shares.
 */
export function programOf(surface: GraphSurface, kind = kindOf(surface)): Entry | undefined {
  const { graph } = surface
  if (!graph) return undefined
  const blend = blendOf(surface, kind),
    slot = `${kind}:${blend}`
  let held = kept.get(graph)
  if (!held) kept.set(graph, (held = new Map()))
  const last = held.get(slot)
  if (last?.shape === graph.shape) return last.entry
  let entry: Entry
  try {
    const { compiled, key } = compileFor(graph, kind, blend)
    const shared = idOf(kind, key, (id) => ({ kind, compiled, graph, id }))
    // The values are this graph's; the program is the first graph's of the same text.
    entry = { kind, compiled, graph, id: shared.id }
  } catch (error) {
    entry = { error: error instanceof Error ? error.message : String(error) }
    refused.push(entry.error)
  }
  held.set(slot, { shape: graph.shape, entry })
  return entry
}

/** The programs of `kind` among those known, by id: what a module of the transparent pass holds the
 *  functions of. */
export const programsOf = (kind: ProgramKind): readonly SurfaceProgram[] => known[kind]

/** The refusals made since the last call: what the frame names once (`material-graph-refused`). */
export const takeGraphRefusals = () => refused.splice(0)
