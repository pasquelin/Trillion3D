/**
 * THE GRAPH AS THE ENGINE WALKS IT.
 *
 * `../resources.ts` names what the engine READS of its graph — a surface, a texture, a geometry,
 * a node held by identity. This file names the same graph as the engine WALKS: the pose it
 * reads to compute a world matrix of its own, the fields a watch compares frame after frame,
 * the chain it climbs. Every node is one of the engine's own (`../graph/`), told apart by its
 * `kind` (`../graph/kinds.ts`); the pose shapes below stay shapes because a camera controller
 * writes them on whatever pose it is handed.
 */
import type { GraphAnyLight } from '../graph/kinds.ts';
import type { GraphMesh } from '../graph/mesh.ts';
import type { GraphNode } from '../graph/node.ts';
import type { HostGraphGeometry } from './graphResources.ts';
import type { HostBox } from '../resources.ts';

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

/** A node of the graph as a walk sees it: its identity, its local pose, its world matrix and
 *  its chain. The engine computes its OWN world matrices from the local poses
 *  (`../world/tree.ts`). */
export type HostGraphNode = GraphNode;

/** A node the engine adds copies to: the group a replication hangs its instances on. */
export type HostGraphGroup = GraphNode;

/** A drawn node of the graph: its geometry and its surface, or one per geometry group. */
export type HostGraphMesh = GraphMesh;

/** A node that bounds itself, or whose geometry does: the two boxes the bounds rule reads
 *  (`../world/bounds.ts`), the node's own winning over its geometry's as the reference does. */
export type HostBoundedNode = GraphNode & {
  readonly geometry?: HostGraphGeometry;
  boundingBox?: HostBox | null;
  computeBoundingBox?(): void;
};

/** A light of the graph, with the numbers its kind declares. A watch compares them per frame. */
export type HostLightNode = GraphAnyLight;
