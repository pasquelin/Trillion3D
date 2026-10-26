import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { layerSlot, type MaterialLayers } from '../../geometry/rows/page/pageRowMaterial.ts'
import { maskClipValue, maskOf } from '../graph/maskProgram.ts'
import { depthOffsetOf } from '../graph/pdoProgram.ts'
import { displacementOf } from '../graph/displacementProgram.ts'
import { altSetOf } from '../graph/state.ts'
import { isProgram, programOf, type SurfaceProgram } from '../graph/surfaceProgram.ts'
import { GRAPH_HEADER, MATERIAL_RECORD_TEXELS, MATERIAL_RECORD_WORDS } from './materialLayout.ts'
import { copyChanged, type MaterialSurface } from './materialRecord.ts'
import type { MaterialEntry, MaterialRecords } from './materialState.ts'

/**
 * THE VALUES OF A SURFACE'S GRAPH, in the material table beside its record: a header texel — the id
 * of the graph's program, `SurfaceProgram.id`, which the transparent pass and the rasters' masks
 * and offsets choose their functions by, then its bits (`GRAPH_HEADER`) —, then the parameters the
 * graph names and the slot of each texture it reads in the colour atlas (`Slots.fill`), as many
 * texels as the program holds, from the first texel of a block of record places the surface owns — a
 * place holds eleven texels — which its record names (`graph`, the header texel plus one). A graph's
 * program is a resolve class of its own (`../graph/surfaceClasses.ts`), its values are the
 * surface's: two surfaces whose graphs compile alike share the class and each reads its own block,
 * with no binding more than the table. Written again where the surface or the atlas's slots moved,
 * with its record. What changes each image — the clocks, the camera — is not here: the rasters read
 * it from the graph frame (`../../visibility/shader/graphFrameWgsl.ts`).
 */
export interface GraphBlock {
  /** The first record place of the block, and how many it takes. */
  rank: number
  count: number
}

/** The words of a block's header: one texel. */
const HEADER_WORDS = 4

/** One block's words, filled before they are compared with the table's. */
let scratch = new Uint32Array(0)

/** A block of `count` places: a freed one that holds them, else new places at the table's end. */
function takeBlock(p: MaterialRecords, count: number): GraphBlock {
  const at = p.graphFree.findIndex((block) => block.count >= count)
  if (at >= 0) return p.graphFree.splice(at, 1)[0]
  const rank = p.held
  p.held += count
  p.ints = resized(p.ints, p.held * MATERIAL_RECORD_WORDS)
  return { rank, count }
}

/** Gives back the block `entry` holds, if any. */
export function freeGraphBlock(p: MaterialRecords, entry: MaterialEntry) {
  if (entry.graph) p.graphFree.push(entry.graph)
  entry.graph = undefined
}

/**
 * Writes the values of the graph `mat` wears into its block, taken or grown at need, and gives the
 * `graph` word its record holds: zero for a surface with no graph that compiles (its block given
 * back). `changed` says whether a word of the block changed, its places then marked written.
 */
export function writeGraphRecord(
  p: MaterialRecords,
  mat: MaterialSurface,
  entry: MaterialEntry,
  layers: MaterialLayers,
) {
  const program = programOf(mat)
  if (!isProgram(program)) {
    freeGraphBlock(p, entry)
    return { word: 0, channels: 0, clip: undefined, changed: false }
  }
  const { slots } = program.compiled
  const words = HEADER_WORDS + ((slots.bytes / 4) | 0)
  const count = ceilDiv(words / 4, MATERIAL_RECORD_TEXELS)
  if (entry.graph && entry.graph.count < count) freeGraphBlock(p, entry)
  entry.graph ??= takeBlock(p, count)
  if (scratch.length < words) scratch = new Uint32Array(words)
  scratch.fill(0, 0, HEADER_WORDS)
  const { rank } = entry.graph
  const mask = maskOf(program)
  scratch[0] = program.id
  scratch[1] =
    (mask ? GRAPH_HEADER.mask : 0) |
    (program.kind === 'blend' ? GRAPH_HEADER.blend : 0) |
    (depthOffsetOf(program) ? GRAPH_HEADER.depthOffset : 0) |
    (displacementOf(program) ? GRAPH_HEADER.displacement : 0)
  slots.fill(program.graph, scratch.buffer, 4 * HEADER_WORDS, (texture) =>
    layerSlot(layers.mapLayer, texture),
  )
  const changed = copyChanged(p.ints, rank * MATERIAL_RECORD_WORDS, scratch.subarray(0, words))
  if (changed) for (let r = 0; r < count; r++) p.written.mark(rank + r)
  return {
    word: rank * MATERIAL_RECORD_TEXELS + 1,
    channels: channelsOfGraph(program),
    clip: mask ? maskClipValue(mat) : undefined,
    changed,
  }
}

/** The channels word (`channelsOf`) of a surface that wears `program`: the first texture set past the
 *  first that it reads, as the one map of a record that reads one — a pass that carries a second
 *  set (`../../blend/vertexWgsl.ts`) takes the set the record names. */
const channelsOfGraph = ({ compiled }: SurfaceProgram) => altSetOf(compiled.uses.sets)
