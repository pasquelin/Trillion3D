import { pixelOf, type PixelProgram } from './pixelProgram.ts'
import type { RasterProgram } from './outputProgram.ts'
import { isProgram, programOf, type GraphSurface } from './surfaceProgram.ts'
import { wpoOf } from './wpoProgram.ts'

/**
 * THE GRAPH OUTPUTS THE RASTERS OF A SESSION EVALUATE: the programs they evaluate at a pixel — the
 * cutouts (`maskProgram.ts`) and the depth offsets (`pdoProgram.ts`), `pixelPrograms` —, and the vertex offsets
 * (`wpoProgram.ts`) of the programs its surfaces wear, held by the session (`WebgpuVisState.rasters`)
 * from its open, so that every module it makes holds the same ones — a cutout that was not the same on
 * both sides would make a shadow that does not match the silhouette, a vertex moved in one pass and
 * not in another a surface that does not meet its own shadow. Only the programs its surfaces wear:
 * the programs an earlier session, or an earlier text of an edited graph, compiled are not in it.
 * Sorted by key, so that two sessions of the same surfaces build the same modules. `textures` is the
 * device's answer to whether a vertex stage may read the colour atlas (`grantsVertexTextures`): an
 * offset that reads a texture is held only where it does.
 */
export interface GraphRasters {
  readonly pixelPrograms: readonly PixelProgram[]
  readonly offsets: readonly RasterProgram[]
  readonly textures: boolean
}

/** No graph output, on a device that lets a vertex stage read the atlas. */
export const NO_RASTERS: GraphRasters = { pixelPrograms: [], offsets: [], textures: true }

/** `held` and the programs of `surfaces` joined, each once, by key. */
const joined = <P extends RasterProgram>(held: readonly P[], added: Iterable<P | undefined>) => {
  const byKey = new Map(held.map((program) => [program.key, program]))
  for (const program of added) if (program) byKey.set(program.key, program)
  return byKey.size === held.length ? held : [...byKey.values()].sort((a, b) => a.key - b.key)
}

/**
 * The outputs of the programs `surfaces` wear (compiling them where not yet), besides those `held`
 * already holds: the same object when nothing joined.
 */
export function graphRastersOf(
  surfaces: Iterable<GraphSurface>,
  held: GraphRasters = NO_RASTERS,
): GraphRasters {
  const programs = []
  for (const surface of surfaces) {
    const program = surface.graph && programOf(surface)
    if (isProgram(program)) programs.push(program)
  }
  const pixelPrograms = joined(
    held.pixelPrograms,
    programs.map((program) => pixelOf(program)),
  )
  const offsets = joined(
    held.offsets,
    programs.map((program) => wpoOf(program, held.textures)),
  )
  return pixelPrograms === held.pixelPrograms && offsets === held.offsets
    ? held
    : { pixelPrograms, offsets, textures: held.textures }
}
