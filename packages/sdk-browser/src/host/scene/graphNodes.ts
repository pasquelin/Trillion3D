/**
 * THE GRAPH AS THE ENGINE WALKS IT.
 *
 * `../resources.ts` names what the engine READS of its graph — a surface, a texture, a geometry,
 * a node held by identity. This file names the same graph as the engine WALKS: the pose it
 * reads to compute a world matrix of its own, the fields a watch compares frame after frame,
 * the chain it climbs. Every node is the core's `Object3D`: a group or a bare node as the core
 * builds it, a node that draws, looks or lights one of the engine's own (`../graph/`), told apart
 * by its `kind` (`../graph/kinds.ts`); the pose shapes below stay shapes because a camera controller
 * writes them on whatever pose it is handed.
 */
import type { GraphAnyLight } from '../graph/kinds.ts';
import type { GraphMesh } from '../graph/mesh.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { HostBox } from '../resources.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';

/** Three numbers of a pose, as the host stores them and a boundary sets them back. */
export type HostVector = {
  /** Left to right. */
  x: number;
  /** Bottom to top. */
  y: number;
  /** Back to front. */
  z: number;
  /** Writes the three numbers. */
  set(x: number, y: number, z: number): unknown;
};

/** The orientation of a pose, as the host stores it: `(x, y, z, w)`. A camera controller writes
 *  exactly this shape, so `../../camera/controls/types.ts` reads it from here rather than redeclaring it. */
export type HostRotation = {
  /** The first number. */
  x: number;
  /** The second number. */
  y: number;
  /** The third number. */
  z: number;
  /** The fourth number. */
  w: number;
  /** Writes the four numbers. */
  set(x: number, y: number, z: number, w: number): unknown;
};

/** A drawn node of the graph: its geometry and its surface, or one per geometry group. */
export type HostGraphMesh = GraphMesh;

/** A node that bounds itself, or whose geometry does: the two boxes the bounds rule reads
 *  (`../world/bounds.ts`), the node's own winning over its geometry's as the reference does. */
export type HostBoundedNode = Object3D & {
  readonly geometry?: Geometry;
  boundingBox?: HostBox | null;
  computeBoundingBox?(): void;
};

/** A light of the graph, with the numbers its kind declares. A watch compares them per frame. */
export type HostLightNode = GraphAnyLight;
