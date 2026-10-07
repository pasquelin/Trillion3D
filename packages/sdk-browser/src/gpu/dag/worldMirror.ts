/**
 * THE WORLD DAG'S RESIDENCY, A MIRROR OF THE SCENE'S (#1332).
 *
 * The world DAG rides in the one packing as one more root, packed last (`worldSuperRoots.ts`), so
 * the packing holds more pages than the rows' residency flags name: handed as they are, the cut's
 * residency refuses them (`GPU_SELECTION_RESIDENCY_COUNT_CHANGED`). This mirror is the one array
 * the cut reads: the scene's pages as the rows hold them, then the world's — a super-root as its
 * own bundle is held (`superRoot`), an object root as its placement's manifest root cover.
 *
 * An object root has no page of its own in the world DAG: its placed object draws it. It is
 * resident only while that object is placed (`place`, its `origin`) and every root of the cover
 * its placement packs is resident, as a cell's coarse stand-in stays shown until its objects are loaded
 * and drawable. So the cut keeps a cell's super-root while its objects are not drawable — no hole
 * when a cell comes near —, and reads the object roots, never the super-root, once they are —
 * the cut's own `parent stands in for its children` term, no second path (rule 7). A placement
 * that leaves turns its object roots out the same step: the super-root stands in again.
 *
 * Handed over by difference (`ResidencyChanges`): a frame copies the scene pages the rows name, and
 * mirrors only the objects whose cover or placement moved; nothing scans the world.
 */
import type { ResidencyChanges } from '../core/selection.ts'
import type { PackedDag } from './types.ts'
import { sortPages } from '../../../../sdk-core/src/page/integrationPlan.ts'
import { createDenseKeySet } from '../../webgpu/cut/denseKeys.ts'

/** The mirror of `packed`, whose `world` root (`packed.cutLinks`), packed last, is the world DAG
 *  with `origins` per rank (`worldRootDag`): the placed object of an object root, -1 otherwise. */
export function createWorldResidencyMirror(packed: PackedDag & Required<Pick<PackedDag, 'world'>>) {
  const { root, origins } = packed.world
  const { pageBase, pageCount } = packed.cutLinks[root]
  if (pageBase + pageCount !== packed.pageCount) throw new Error('GPU_WORLD_DAG_NOT_LAST')
  if (origins.length !== pageCount) throw new Error('GPU_WORLD_ORIGINS_COUNT_CHANGED')
  const { objects, first, ranks } = objectRanks(origins, pageCount)
  const changed = createDenseKeySet()
  const m: MirrorState = {
    ...{ packed, origins, pageBase, objects, first, ranks, changed },
    flags: new Uint32Array(packed.pageCount),
    pageWorlds: new Uint32Array(packed.pageCones.buffer, packed.pageCones.byteOffset, pageBase),
    placementOf: new Int32Array(objects).fill(-1),
    objectsOf: new Map(),
    dirty: new Set(),
    moved: {
      get pages() {
        return changed.list
      },
      get count() {
        return changed.count
      },
    } satisfies ResidencyChanges,
    handed: false,
    covers: new Map(),
  }
  const { flags, placementOf } = m
  return {
    /** The residency the cut reads, every packed page: the scene's, then the world DAG's. */
    flags,
    /** Bytes of its host tables, which the cut's `hostBytes` counts. */
    get hostBytes() {
      return (
        flags.byteLength +
        first.byteLength +
        ranks.byteLength +
        placementOf.byteLength +
        changed.byteLength
      )
    },
    /** Object `object` (an `origin`) is drawn by scene placement `w` (`packed.cutLinks`). */
    place: (object: number, w: number) => place(m, object, w),
    /** Object `object` left its placement: its object roots turn out at the next `update`. */
    unplace: (object: number) => unplace(m, object),
    /** Super-root `rank` of the world DAG is resident, or no longer: its bundle is held or left. */
    superRoot(rank: number, resident: boolean) {
      if (origins[rank] < 0) write(m, pageBase + rank, resident ? 1 : 0)
    },
    /**
     * The scene's residency `scene` — the rows' flags, one per scene page — at the pages `changes`
     * names (every page without), mirrored onto the world DAG: the whole array, and the pages it
     * moved, sorted, which the cut's upload reads (`GpuSelection.updateResidency`).
     */
    update: (scene: Uint32Array, changes?: ResidencyChanges) => update(m, scene, changes),
  }
}

type MirrorState = {
  packed: PackedDag
  origins: Int32Array
  pageBase: number
  objects: number
  /** Each object's world ranks, by origin: offsets into `ranks`. */
  first: Uint32Array
  ranks: Uint32Array
  flags: Uint32Array
  pageWorlds: Uint32Array
  /** The placement drawing each object, -1 when none; each placement's objects. */
  placementOf: Int32Array
  objectsOf: Map<number, Set<number>>
  /** Objects whose placement or cover moved since `update`; the pages whose flag moved, each once,
   *  as the row journal lists them (`webgpu/row/journal.ts`). */
  dirty: Set<number>
  changed: ReturnType<typeof createDenseKeySet>
  moved: ResidencyChanges
  /** Whether `moved` was handed over: the next write starts a new list. */
  handed: boolean
  /** Whether every root of a placement's cover is resident, read once an update. */
  covers: Map<number, boolean>
}

/** Each object's world ranks, by origin: offsets, then the ranks (built once, two passes). */
function objectRanks(origins: Int32Array, pageCount: number) {
  let objects = 0
  for (let rank = 0; rank < pageCount; rank++) objects = Math.max(objects, origins[rank] + 1)
  const first = new Uint32Array(objects + 1),
    ranks = new Uint32Array(pageCount)
  for (let rank = 0; rank < pageCount; rank++) if (origins[rank] >= 0) first[origins[rank] + 1]++
  for (let o = 0; o < objects; o++) first[o + 1] += first[o]
  const filled = first.slice(0, objects)
  for (let rank = 0; rank < pageCount; rank++)
    if (origins[rank] >= 0) ranks[filled[origins[rank]]++] = rank
  return { objects, first, ranks }
}

/** Writes `page`'s flag; whether it moved. */
function write(m: MirrorState, page: number, value: number) {
  if (m.flags[page] === value) return false
  if (m.handed) m.changed.clear()
  m.handed = false
  m.flags[page] = value
  m.changed.add(page)
  return true
}

/** Whether every root of placement `w`'s cover is resident: a primitive without its group
 *  structure is all roots. */
function coverResident(m: MirrorState, w: number) {
  const known = m.covers.get(w)
  if (known !== undefined) return known
  const resident = readCover(m, w)
  m.covers.set(w, resident)
  return resident
}

function readCover({ packed, flags }: MirrorState, w: number) {
  const { structure, pageBase: base, pageCount: count } = packed.cutLinks[w]
  if (structure) return structure.roots.every((root) => flags[base + root] !== 0)
  for (let page = base; page < base + count; page++) if (!flags[page]) return false
  return true
}

function mirror(m: MirrorState, object: number) {
  const w = m.placementOf[object],
    value = w >= 0 && coverResident(m, w) ? 1 : 0
  for (let at = m.first[object]; at < m.first[object + 1]; at++)
    write(m, m.pageBase + m.ranks[at], value)
}

function scenePage(m: MirrorState, scene: ArrayLike<number>, page: number) {
  if (!write(m, page, scene[page] ? 1 : 0)) return
  const own = m.objectsOf.get(m.pageWorlds[page])
  if (own) for (const object of own) m.dirty.add(object)
}

function place(m: MirrorState, object: number, w: number) {
  if (object >= m.objects || m.placementOf[object] === w) return
  unplace(m, object)
  m.placementOf[object] = w
  const own = m.objectsOf.get(w)
  if (own) own.add(object)
  else m.objectsOf.set(w, new Set([object]))
  m.dirty.add(object)
}

function unplace(m: MirrorState, object: number) {
  const w = object < m.objects ? m.placementOf[object] : -1
  if (w < 0) return
  m.placementOf[object] = -1
  const own = m.objectsOf.get(w)!
  own.delete(object)
  if (!own.size) m.objectsOf.delete(w)
  m.dirty.add(object)
}

function update(m: MirrorState, scene: Uint32Array, changes: ResidencyChanges | undefined) {
  const { pageBase, changed } = m
  if (scene.length !== pageBase) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED')
  if (m.handed) {
    changed.clear()
    m.handed = false
  }
  if (changes) for (let i = 0; i < changes.count; i++) scenePage(m, scene, changes.pages[i])
  else for (let page = 0; page < pageBase; page++) scenePage(m, scene, page)
  for (const object of m.dirty) mirror(m, object)
  m.dirty.clear()
  m.covers.clear()
  sortPages(changed.list, changed.count)
  m.handed = true
  return { flags: m.flags, changes: m.moved }
}
