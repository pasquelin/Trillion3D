/**
 * THE WORLD DAG'S RESIDENCY, A MIRROR OF THE SCENE'S.
 *
 * The world DAG rides in the one packing as one more root, wherever it sits (`worldSuperRoots.ts`). Its
 * super-roots are pages like any other: the rows hold them, their flags are the rows'. Its object
 * clusters are not: a placed object draws itself, through its own placement. This mirror is the
 * one array the cut reads: the rows' flags, each object cluster's set from its placement.
 *
 * An object cluster is resident only while its object is placed — a placement links it
 * (`worldLinks.ts`) — and every root of the cover that placement packs is resident, as a cell's
 * coarse stand-in stays shown until its objects are loaded and drawable. So the cut keeps a group's
 * super-roots while one of its objects is not drawable — no hole when a cell comes near —, and the
 * placements draw once every object of the group is, where the group projects past the threshold
 * — the cut's own `parent stands in for its children` term, no second path (rule 7). A placement
 * that leaves turns its object out the same step: the super-roots stand in again.
 *
 * Handed over by difference (`ResidencyChanges`): a frame copies the pages the rows name, and
 * mirrors only the objects whose cover or placement moved; nothing scans the world.
 */
import type { ResidencyChanges } from '../core/selection.ts'
import type { PackedDag } from './types.ts'
import { sortPages } from '../../../../sdk-core/src/page/integrationPlan.ts'
import { createDenseKeySet } from '../../webgpu/cut/denseKeys.ts'
import { SELECTION_NONE as NONE } from '../core/selection.ts'

type WorldPacked = PackedDag & Required<Pick<PackedDag, 'world'>>
type Mirror = ReturnType<typeof mirrorState>

/** What the mirror of `packed` holds: the flags, and each object's placement and back. */
function mirrorState(packed: WorldPacked) {
  const { root, origins } = packed.world
  const { pageBase, pageCount } = packed.cutLinks[root]
  if (origins.length !== pageCount) throw new Error('GPU_WORLD_ORIGINS_COUNT_CHANGED')
  const { clusterOf } = packed.world
  return {
    packed,
    pageBase,
    pageEnd: pageBase + pageCount,
    clusterOf,
    flags: new Uint32Array(packed.pageCount),
    pageWorlds: new Uint32Array(
      packed.pageCones.buffer,
      packed.pageCones.byteOffset,
      packed.pageCount,
    ),
    /** The placement drawing each object, -1 when none, and the object each placement draws. */
    placementOf: new Int32Array(clusterOf.length).fill(-1),
    objectOf: new Int32Array(packed.worldCount).fill(-1),
    /** Objects whose placement or cover moved since `update`; the pages whose flag moved, each
     *  once, as the row journal lists them (`webgpu/row/journal.ts`). */
    dirty: new Set<number>(),
    changed: createDenseKeySet(),
    /** Whether each placement's cover is resident, read once per `update`. */
    covers: new Map<number, boolean>(),
    /** Whether `changed` was handed over: the next write starts a new list. */
    handed: false,
  }
}

/** Writes `page`'s flag; whether it moved. */
function write(m: Mirror, page: number, value: number) {
  if (m.flags[page] === value) return false
  m.flags[page] = value
  m.changed.add(page)
  return true
}

/** Whether every root of placement `w`'s cover is resident: a primitive without its group
 *  structure is all roots. */
function coverResident(m: Mirror, w: number) {
  const known = m.covers.get(w)
  if (known !== undefined) return known
  const { structure, pageBase: base, pageCount: count } = m.packed.cutLinks[w]
  let resident = true
  if (structure) resident = structure.roots.every((root) => m.flags[base + root] !== 0)
  else for (let page = base; page < base + count && resident; page++) resident = !!m.flags[page]
  m.covers.set(w, resident)
  return resident
}

/** The rows' flag of `page`: a scene page's, its placement's object told; a super-root's. An
 *  object cluster's is the mirror's own. */
function rowPage(m: Mirror, scene: ArrayLike<number>, page: number) {
  if (page >= m.pageBase && page < m.pageEnd) {
    if (m.packed.world.origins[page - m.pageBase] < 0) write(m, page, scene[page] ? 1 : 0)
    return
  }
  if (!write(m, page, scene[page] ? 1 : 0)) return
  const object = m.objectOf[m.pageWorlds[page]]
  if (object >= 0) m.dirty.add(object)
}

/** Placement `w` draws `object` now, or nothing (`-1`): what it drew before, and where `object`
 *  was drawn before, let go. */
function link(m: Mirror, w: number, object: number) {
  const before = m.objectOf[w]
  if (before === object) return
  if (before >= 0) {
    m.placementOf[before] = -1
    m.dirty.add(before)
  }
  m.objectOf[w] = object
  if (object < 0) return
  const was = m.placementOf[object]
  if (was >= 0) m.objectOf[was] = -1
  m.placementOf[object] = w
  m.dirty.add(object)
}

/** The object a placement's link names, or none. */
const linkedObject = (m: Mirror, c: number) =>
  c === NONE ? -1 : m.packed.world.origins[c - m.pageBase]

/** `scene`, the rows' residency at the pages `changes` names, mirrored (`createWorldResidencyMirror`). */
function update(m: Mirror, scene: Uint32Array, changes?: ResidencyChanges) {
  if (scene.length !== m.packed.pageCount) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED')
  if (m.handed) {
    m.changed.clear()
    m.handed = false
  }
  if (changes) for (let i = 0; i < changes.count; i++) rowPage(m, scene, changes.pages[i])
  else for (let page = 0; page < m.packed.pageCount; page++) rowPage(m, scene, page)
  for (const object of m.dirty) {
    const w = m.placementOf[object]
    write(m, m.pageBase + m.clusterOf[object], w >= 0 && coverResident(m, w) ? 1 : 0)
  }
  m.dirty.clear()
  m.covers.clear()
  sortPages(m.changed.list, m.changed.count)
  m.handed = true
}

/** The mirror of `packed`, whose `world` root (`packed.cutLinks`), wherever it sits, is the world DAG
 *  with `origins` per rank (`worldRootDag`): the placed object of an object cluster, -1 otherwise;
 *  each placement linked to an object (`packed.world.links`) draws it, a link that moves told by
 *  the cut's upload (`linksMoved`) and mirrored at the next `update`. */
export function createWorldResidencyMirror(packed: WorldPacked) {
  const m = mirrorState(packed)
  const { links } = packed.world
  links.forEach((c, w) => link(m, w, linkedObject(m, c)))
  // A link that moves is read at once, its objects' clusters mirrored at the next update.
  packed.world.linksMoved = (placements, count) => {
    for (let i = 0; i < count; i++) link(m, placements[i], linkedObject(m, links[placements[i]]))
  }
  const moved = {
    get pages() {
      return m.changed.list
    },
    get count() {
      return m.changed.count
    },
  } satisfies ResidencyChanges
  /** What `update` hands back, one object a mirror. */
  const updated = { flags: m.flags, changes: moved as ResidencyChanges }
  return {
    /** The residency the cut reads, every packed page: the rows', each object cluster's its own. */
    flags: m.flags,
    /** Bytes of its host tables, which the cut's `hostBytes` counts. */
    get hostBytes() {
      const { flags, clusterOf, placementOf, objectOf, changed } = m
      return (
        flags.byteLength +
        clusterOf.byteLength +
        placementOf.byteLength +
        objectOf.byteLength +
        changed.byteLength
      )
    },
    /**
     * The rows' residency `scene` — one flag per packed page — at the pages `changes` names (every
     * page without), each object cluster mirrored from its placement: the whole array, and the
     * pages it moved, sorted, which the cut's upload reads (`GpuSelection.updateResidency`).
     */
    update(scene: Uint32Array, changes?: ResidencyChanges) {
      update(m, scene, changes)
      return updated
    },
  }
}
