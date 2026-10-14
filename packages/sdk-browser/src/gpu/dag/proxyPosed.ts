/**
 * THE POSED COPIES OF THE PROXY (`proxyInstances.ts`): a placement — or a blended copy — whose mesh
 * deforms stands at a copy of its mesh's proxy of its own in the arena (`proxyArena.ts`), its rest
 * shape to begin with, which the pose moves where the deformation put it (`proxyPose.ts`). Each is
 * taken when the placement first wears the mesh and given back when it stands at the rest shape
 * again.
 */
import type { RuntimeCutProxy } from '../../../../sdk-core/src/contracts/proxy.ts'
import type { ProxyArena } from './proxyArena.ts'
import type { Placed, ProxyColumns } from './proxyColumns.ts'
import { createProxyPose, type PoseEntry } from './proxyPose.ts'
import type { DagRoot, PackedDag } from './types.ts'

/** The copy of a mesh's proxy a deformed placement owns, which the pose moves. */
type Posed = { cut: RuntimeCutProxy; placed: Placed; node: number; triangle: number }

/** What the pose reads of the deformation (`deformation/session.ts`): the float pool its records
 *  lie in, each placement's record in it (the first float plus one, zero for none) and the revision
 *  of the records. */
export type PoseHost = {
  pool: GPUBuffer | undefined
  recordOf(world: object): number
  revision: number
}

/** The posed copies of `packed`'s `slots` placements, then of the blended copies `copies` holds,
 *  in `arena`, their columns taken among the meshes' (`columns`). */
export function createPosedCopies(
  device: GPUDevice,
  arena: ProxyArena,
  columns: ProxyColumns,
  packed: Pick<PackedDag, 'worldSources'>,
  slots: number,
  copies: () => readonly { matrix: { readonly elements: ArrayLike<number> } }[],
) {
  const posed = new Map<number, Posed>()
  const pose = createProxyPose(device)
  let posedRevision = -1,
    /** Moves as a copy is taken or given back: with the arena's layout, where the copies lie
     *  (`layoutKey`); the entries were laid at `laid`. */
    changes = 0,
    laid = -1,
    fresh = false
  const layoutKey = () => changes + arena.revision
  // The poses as the pose reads them, kept while the copies and where they lie stay: laid again
  // when a copy is made or given back, or the arena is laid out again.
  const entries: PoseEntry[] = [],
    keys: number[] = []

  /** Placement `w` stands at its mesh's rest shape again: its copy is given back. */
  function drop(w: number) {
    const copy = posed.get(w)
    if (!copy) return
    columns.release(copy.triangle, copy.placed.triangles, copy.node, copy.placed.nodes)
    posed.delete(w)
    changes++
  }

  return {
    /** Whether placement `w` stands at a posed copy. */
    has: (w: number) => posed.has(w),
    /** The copy of `placed`'s mesh that placement `w` owns: its triangles and nodes in the arena,
     *  the rest shape to begin with; none where the arena cannot hold it. */
    take(w: number, cut: RuntimeCutProxy, placed: Placed) {
      const held = posed.get(w)
      if (held?.cut === cut) return held
      if (held) drop(w)
      const got = columns.taken(placed.triangles, placed.nodes)
      if (!got) return undefined
      columns.uploadColumns(cut, got.triangle, got.node)
      const copy = { cut, placed, node: got.node, triangle: got.triangle }
      posed.set(w, copy)
      changes++
      fresh = true
      return copy
    },
    drop,
    /** The copies of members past `count`, given back. */
    dropPast(count: number) {
      for (const w of [...posed.keys()]) if (w >= count) drop(w)
    },
    /**
     * The copies posed, in `encoder`, before the first program of the image that traces them: when
     * the deformation's records moved (`host.revision`) or a copy is new, and once the pose's
     * program is built.
     */
    pose(encoder: GPUCommandEncoder, host: PoseHost) {
      const buffer = arena.buffer
      if (!buffer || !posed.size || !host.pool) return
      if (host.revision === posedRevision && !fresh) return
      if (laid !== layoutKey()) {
        laid = layoutKey()
        entries.length = keys.length = 0
        for (const [w, copy] of posed) {
          keys.push(w)
          entries.push({
            cut: copy.cut,
            restTriangle: copy.placed.triangle,
            posedTriangle: copy.triangle,
            posedNode: copy.node,
            corners: arena.layout.deform + copy.placed.corner!,
            record: 0,
          })
        }
      }
      for (let k = 0; k < entries.length; k++) {
        // A placement's record is found by its root's world, a blended copy's by its matrix.
        const w = keys[k],
          world =
            w < slots ? (packed.worldSources[w] as DagRoot).world : copies()[w - slots]?.matrix
        entries[k].record = world ? host.recordOf(world) : 0
      }
      if (!pose.run(encoder, buffer, host.pool, entries, layoutKey())) return
      posedRevision = host.revision
      fresh = false
    },
    dispose: () => pose.dispose(),
  }
}
