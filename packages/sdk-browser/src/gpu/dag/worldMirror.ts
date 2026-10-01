/**
 * THE WORLD DAG'S RESIDENCY, A MIRROR OF THE SCENE'S (#1332).
 *
 * The world DAG rides in the one packing as one more root, packed last (`worldSuperRoots.ts`), so
 * the packing holds more pages than the rows' residency flags name: handed as they are, the cut's
 * residency refuses them (`GPU_SELECTION_RESIDENCY_COUNT_CHANGED`). This mirror is the one array
 * the cut reads: the scene's pages as the rows hold them, then the world's — a super-root as its
 * own bundle is held (`holdBundles`), an object root as its placement's manifest root cover.
 *
 * An object root has no page of its own in the world DAG: its placed object draws it. It is
 * resident only while that object is placed (`place`, its `origin`) and every root of the cover
 * its placement packs is resident, as an the reference engine HLOD stays shown until its cell's actors are loaded
 * and drawable. So the cut keeps a cell's super-root while its objects are not drawable — no hole
 * when a cell comes near —, and reads the object roots, never the super-root, once they are —
 * the cut's own `parent stands in for its children` term, no second path (rule 7). A placement
 * that leaves turns its object roots out the same step: the super-root stands in again.
 *
 * Handed over by difference (`ResidencyChanges`): a frame copies the scene pages the rows name, and
 * mirrors only the objects whose cover or placement moved; nothing scans the world.
 */
import type { ResidencyChanges } from '../core/selection.ts';
import type { PackedDag } from './types.ts';
import { sortPages } from '../../../../sdk-core/src/page/integrationPlan.ts';
import { createDenseKeySet } from '../../webgpu/cut/denseKeys.ts';

/** The ranks of a world DAG grouped by `keys` (one per rank, -1 for none): each key's ranks are
 *  `ranks[first[k]]` to `ranks[first[k + 1]]`, built once in two passes. */
function rankIndex(keys: ArrayLike<number>) {
  let count = 0;
  for (let rank = 0; rank < keys.length; rank++) count = Math.max(count, keys[rank] + 1);
  const first = new Uint32Array(count + 1),
    ranks = new Uint32Array(keys.length);
  for (let rank = 0; rank < keys.length; rank++) if (keys[rank] >= 0) first[keys[rank] + 1]++;
  for (let k = 0; k < count; k++) first[k + 1] += first[k];
  const filled = first.slice(0, count);
  for (let rank = 0; rank < keys.length; rank++)
    if (keys[rank] >= 0) ranks[filled[keys[rank]]++] = rank;
  return { count, first, ranks };
}

/** The mirror of `packed`, whose `world` root (`packed.cutLinks`), packed last, is the world DAG
 *  with `origins` per rank (`worldRootDag`): the placed object of an object root, -1 otherwise;
 *  and `bundles`, the world bundle holding a super-root's page, -1 for an object root. */
export function createWorldResidencyMirror(packed: PackedDag & Required<Pick<PackedDag, 'world'>>) {
  const { root, origins, bundles } = packed.world;
  const { pageBase, pageCount } = packed.cutLinks[root];
  if (pageBase + pageCount !== packed.pageCount) throw new Error('GPU_WORLD_DAG_NOT_LAST');
  if (origins.length !== pageCount || bundles.length !== pageCount)
    throw new Error('GPU_WORLD_ORIGINS_COUNT_CHANGED');
  // Each object's world ranks by origin, each bundle's super-roots by bundle.
  const { count: objects, first, ranks } = rankIndex(origins),
    byBundle = rankIndex(bundles);
  const flags = new Uint32Array(packed.pageCount);
  const pageWorlds = new Uint32Array(
    packed.pageCones.buffer,
    packed.pageCones.byteOffset,
    pageBase,
  );
  /** The placement drawing each object, -1 when none; each placement's objects. */
  const placementOf = new Int32Array(objects).fill(-1),
    objectsOf = new Map<number, Set<number>>();
  /** Objects whose placement or cover moved since `update`; the pages whose flag moved, each once,
   *  as the row journal lists them (`webgpu/row/journal.ts`). */
  const dirty = new Set<number>(),
    changed = createDenseKeySet();
  const moved = {
    get pages() {
      return changed.list;
    },
    get count() {
      return changed.count;
    },
    sorted: true,
  } satisfies ResidencyChanges;
  /** Whether `moved` was handed over: the next write starts a new list. */
  let handed = false;
  /** Writes `page`'s flag; whether it moved. */
  const write = (page: number, value: number) => {
    if (flags[page] === value) return false;
    if (handed) changed.clear();
    handed = false;
    flags[page] = value;
    changed.add(page);
    return true;
  };
  /** Whether every root of placement `w`'s cover is resident: a primitive without its group
   *  structure is all roots. */
  const covers = new Map<number, boolean>();
  const coverResident = (w: number) => {
    const known = covers.get(w);
    if (known !== undefined) return known;
    const resident = readCover(w);
    covers.set(w, resident);
    return resident;
  };
  const readCover = (w: number) => {
    const { structure, pageBase: base, pageCount: count } = packed.cutLinks[w];
    if (structure) return structure.roots.every((root) => flags[base + root] !== 0);
    for (let page = base; page < base + count; page++) if (!flags[page]) return false;
    return true;
  };
  const mirror = (object: number) => {
    const w = placementOf[object],
      value = w >= 0 && coverResident(w) ? 1 : 0;
    for (let at = first[object]; at < first[object + 1]; at++) write(pageBase + ranks[at], value);
  };
  const scenePage = (scene: ArrayLike<number>, page: number) => {
    if (!write(page, scene[page] ? 1 : 0)) return;
    const own = objectsOf.get(pageWorlds[page]);
    if (own) for (const object of own) dirty.add(object);
  };
  /** The pinned bundles already held, and the others held now. */
  let heldPinned = 0,
    heldNow = new Set<number>();
  const holdBundle = (bundle: number, resident: boolean) => {
    if (bundle < byBundle.count)
      for (let at = byBundle.first[bundle]; at < byBundle.first[bundle + 1]; at++)
        write(pageBase + byBundle.ranks[at], resident ? 1 : 0);
  };
  /** Object `object` left its placement: its object roots turn out at the next `update`. */
  function unplace(object: number) {
    const w = object < objects ? placementOf[object] : -1;
    if (w < 0) return;
    placementOf[object] = -1;
    const own = objectsOf.get(w)!;
    own.delete(object);
    if (!own.size) objectsOf.delete(w);
    dirty.add(object);
  }
  return {
    /** The residency the cut reads, every packed page: the scene's, then the world DAG's. */
    flags,
    /** Bytes of its host tables, which the cut's `hostBytes` counts. */
    get hostBytes() {
      return (
        flags.byteLength +
        first.byteLength +
        ranks.byteLength +
        byBundle.first.byteLength +
        byBundle.ranks.byteLength +
        placementOf.byteLength +
        changed.byteLength
      );
    },
    /** Object `object` (an `origin`) is drawn by scene placement `w` (`packed.cutLinks`). */
    place(object: number, w: number) {
      if (object >= objects || placementOf[object] === w) return;
      unplace(object);
      placementOf[object] = w;
      const own = objectsOf.get(w);
      if (own) own.add(object);
      else objectsOf.set(w, new Set([object]));
      dirty.add(object);
    },
    unplace,
    /** Scene placement `w` draws object `object` from now on, or none (-1): a row taken or parked. */
    seat(w: number, object: number) {
      const own = objectsOf.get(w);
      if (own) for (const left of own) if (left !== object) unplace(left);
      if (object >= 0) this.place(object, w);
    },
    /** The world bundles held now: the `pinned` top and `held`, ascending (`WorldRootsHold`). A
     *  super-root is resident while its bundle is; only the bundles that moved are written. */
    holdBundles(pinned: number, held: readonly number[]) {
      const next = new Set(held);
      for (let b = heldPinned; b < Math.min(pinned, byBundle.count); b++) holdBundle(b, true);
      heldPinned = Math.max(heldPinned, pinned);
      for (const b of heldNow) if (!next.has(b)) holdBundle(b, false);
      for (const b of next) if (!heldNow.has(b)) holdBundle(b, true);
      heldNow = next;
    },
    /** The objects whose placement or cover moved since the last hand-over mirrored, and the pages
     *  that moved, sorted, which the cut's upload reads (`GpuSelection.updateResidency`). */
    flush() {
      if (handed) {
        changed.clear();
        handed = false;
      }
      for (const object of dirty) mirror(object);
      dirty.clear();
      covers.clear();
      sortPages(changed.list, changed.count);
      handed = true;
      return { flags, changes: moved };
    },
    /**
     * The scene's residency `scene` — the rows' flags, one per scene page — at the pages `changes`
     * names (every page without), mirrored onto the world DAG (`flush`).
     */
    update(scene: Uint32Array, changes?: ResidencyChanges) {
      if (scene.length !== pageBase) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
      if (changes?.sorted)
        for (let i = 0; i < changes.count; i++) scenePage(scene, changes.pages[i]);
      else for (let page = 0; page < pageBase; page++) scenePage(scene, page);
      return this.flush();
    },
  };
}
