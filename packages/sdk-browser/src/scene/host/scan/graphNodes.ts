/**
 * THE GRAPH AS THE ENGINE WALKS IT.
 *
 * This file names the graph as the engine WALKS it: the pose it
 * reads to compute a world matrix of its own, the fields a watch compares frame after frame,
 * the chain it climbs. Every node is the core's `Object3D`: a group or a bare node as the core
 * builds it, a node that draws, looks or lights one of the engine's own (`../graph/`), told apart
 * by its `kind` (`../graph/kinds.ts`).
 */
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import type { Geometry } from '../../../../../sdk-core/src/world/geometry/geometry.ts'
import type { Box3 } from '../../../../../sdk-core/src/world/math/box3.ts'

/** A node that bounds itself, or whose geometry does: the two boxes the bounds rule reads
 *  (`../world/bounds.ts`), the node's own winning over its geometry's. */
export type HostBoundedNode = Object3D & {
  readonly geometry?: Geometry
  boundingBox?: Box3 | null
  computeBoundingBox?(): void
}
