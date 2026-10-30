import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import type { PageSurface } from '../../../geometry/pages/surface.ts'
import { rowFlags } from '../../../geometry/rows/surfaceRow.ts'
import { alphaModeOf } from '../../../../../sdk-core/src/contracts/material.ts'
import { maskOf } from '../../../materials/graph/maskProgram.ts'
import type { TracedMaskReader } from './sceneTraceResources.ts'
import type { SurfaceSeen } from '../../../materials/table/materialState.ts'
import type { RootWorn } from '../../../geometry/selection/types.ts'
import { FLAG_HAS_COLOR, FLAG_HAS_MAP, FLAG_SAMPLED } from '../../../visibility/types.ts'
import { mapUvSetOf } from '../../../visibility/mapUvSet.ts'
import { attributed } from '../../pathTracing/hitPlacements.ts'
import {
  TRACED_MASK_FLAGS,
  TRACED_MASK_SET_SHIFT,
  type TracedMask,
} from '../../reflections/translucency/materialWords.ts'

/** The cutout of a surface, with the version, the atlases' epoch and the textures it was made for: made again when any moved, the material table not asked before. A surface worn in two sessions (two material tables) has a cutout in each, as each table's slots and textures name it. */
const held = new WeakMap<
  object,
  WeakMap<
    object,
    {
      readonly version: number | undefined
      readonly epoch: number
      readonly textures: unknown
      readonly mask?: TracedMask
    }
  >
>()

/** The reader before the atlas and the sampler are named: no root has a cutout, whatever its surface, and nothing it depends on moves, so the writers of the material words keep the words they made. */
export const NO_SCENE_CUTOUTS: TracedMaskReader<{ readonly worn?: RootWorn }> = Object.assign(
  () => undefined,
  { stamp: [] as readonly unknown[] },
)

/** The reader of each runtime: one for the runtime's life, so that the frame asks for it without making another. */
const readers = new WeakMap<WebgpuPagesRuntime, TracedMaskReader<{ readonly worn?: RootWorn }>>()

/**
 * THE CUTOUT OF A PLACEMENT'S SURFACE, as the any-hit test of the scene trace reads it (`sceneMaskWgsl.ts`): for a root whose surface is masked (a cut
 * `alphaTest` and no blend), the threshold its record holds, the slot of its base map in the colour atlas and the bits the visibility rows give its reads
 * of it (`rowFlags`: the map, the filter its slot takes, the vertex colour on a triangle that carries attributes). A surface that wears a graph that wires an `opacityMask`
 * (which the rasters evaluate, `maskProgram.ts`) is cut by it whatever its alpha mode: its cutout names its record in the material table (`TRACED_MASK_FLAGS.graph`) and the
 * texture set the graph reads. A surface that is not masked, or whose graph wires none, has none: its triangles are kept whole. Made once for a surface and kept while its
 * version and the atlases' slots (`SurfaceSeen.epoch`) stand.
 */
export function sceneMaskOf(
  rt: WebgpuPagesRuntime,
): TracedMaskReader<{ readonly worn?: RootWorn }> {
  const known = readers.get(rt)
  if (known) return known
  const read = (root: { readonly worn?: RootWorn }): TracedMask | undefined => {
    const surface = root.worn?.surface
    if (!surface || (alphaModeOf(surface) !== 'mask' && !surface.graph)) return undefined
    const { materialTable } = rt.vis
    const { textures } = rt.vis
    let ofTable = held.get(materialTable)
    if (!ofTable) held.set(materialTable, (ofTable = new WeakMap()))
    const kept = ofTable.get(surface)
    // A surface without a version is never taken as unchanged.
    if (
      kept &&
      kept.version !== undefined &&
      kept.version === surface.version &&
      kept.epoch === materialTable.epoch &&
      kept.textures === textures
    )
      return kept.mask
    const seen = materialTable.surface(surface, rt.vis)
    const mask = maskOfSeen(rt, surface, seen)
    ofTable.set(surface, { version: surface.version, epoch: materialTable.epoch, textures, mask })
    return mask
  }
  // What a cutout depends on beside its surface's version, read as it stands into one array the reader keeps (the writer of the material words copies it when it keeps it): the writer
  // keeps the words while it stands.
  const stamp: unknown[] = [undefined, 0, undefined]
  const reader = Object.defineProperty(read, 'stamp', {
    get: () => {
      const { materialTable, textures } = rt.vis
      stamp[0] = materialTable
      stamp[1] = materialTable.epoch
      stamp[2] = textures
      return stamp
    },
  })
  readers.set(rt, reader)
  return reader
}

function maskOfSeen(
  rt: WebgpuPagesRuntime,
  surface: NonNullable<RootWorn['surface']>,
  seen: SurfaceSeen,
): TracedMask | undefined {
  const { graph } = seen.row
  if (graph && !maskOf(graph)) return undefined
  const { flags } = rowFlags(seen.row, attributed(!!surface.vertexColors), rt.vis.textures)
  // The texture set the map or the graph reads is the row's three flags, one bit each (0 to 7).
  const set = mapUvSetOf(flags) << TRACED_MASK_SET_SHIFT
  if (graph) {
    return {
      cut: 0,
      map: seen.rank,
      flags: TRACED_MASK_FLAGS.masked | TRACED_MASK_FLAGS.graph | set,
    }
  }
  return {
    cut: surface.alphaTest,
    map: seen.row.map,
    flags:
      TRACED_MASK_FLAGS.masked |
      (flags & FLAG_HAS_MAP ? TRACED_MASK_FLAGS.mapped : 0) |
      (flags & FLAG_SAMPLED ? TRACED_MASK_FLAGS.sampled : 0) |
      (flags & FLAG_HAS_COLOR ? TRACED_MASK_FLAGS.coloured : 0) |
      set,
  }
}

/** The roots that wear the materials of the HLOD actors (`WorldRootsHold.surfaces`, by the rank an actor's record names), `count` of them (`RayTracing.actorRanks`): one for
 *  each rank, wearing nothing where the world holds no surface of that rank. Made once for the surfaces and the count, as the world holds them. */
const actorRoots = new WeakMap<
  readonly PageSurface[],
  { readonly count: number; readonly roots: readonly { readonly worn?: RootWorn }[] }
>()

const NO_SURFACES: readonly PageSurface[] = []

export function wornActors(surfaces: readonly PageSurface[] = NO_SURFACES, count = 0) {
  const kept = actorRoots.get(surfaces)
  if (kept?.count === count) return kept.roots
  const roots = Array.from({ length: count }, (_, rank) => {
    const surface = surfaces[rank]
    return surface ? { worn: { surface } } : {}
  })
  actorRoots.set(surfaces, { count, roots })
  return roots
}
