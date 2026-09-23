/**
 * THE HOST SCENE GRAPH, NAMED BY SHAPE.
 *
 * `../resources.ts` names what a host hands the engine to READ — a material, a texture, a
 * geometry, a node held by identity. This file names the same graph as the engine WALKS: the
 * local pose it reads to compute a world matrix of its own, the fields a watch compares frame
 * after frame, the ancestors a chain climbs and the write a boundary sets back on a node the
 * host asked to move. The two files split one vocabulary by responsibility; neither names a
 * rendering library, and any host object of the same shape satisfies them.
 *
 * Building one of these objects is not reading it: the boundary that makes a host node, a host
 * camera or a copy of a host mesh is `graphObjects.ts`, the only file of the walk allowed
 * to name the library its host wrote them with. The geometry, the surface and the texture a node
 * POINTS AT are resources rather than nodes, and live in `graphResources.ts`.
 */
import type { HostNodeMatrix } from '../../math/matrixElements.ts';
import type { HostGraphGeometry, HostGraphMaterial } from './graphResources.ts';
import type { HostBox, HostColour, HostMesh, HostNode, HostScene } from '../resources.ts';

/**
 * The display graph an engine whose image the HOST RENDERER draws writes: it hangs a resident
 * page on it, takes the page back off when the cut drops it, and empties it when the session
 * ends. `HostScene` (`../resources.ts`) is that graph as a composition READS it; this one is
 * the same graph as the engine writes it, which is why it lives here. An engine presenting its
 * own surface adds nothing to the graph it publishes and declares its own writes beside it
 * (`../../cluster/blendSceneRecord.ts`).
 */
export type HostDrawScene = HostScene & {
  /** What the graph is given is what a host boundary BUILT for it: the host raises its own brand
   *  on the objects its renderer accepts and drops any other node silently, so a record of the
   *  engine's own never crosses here. The lights go on through `HostLightScene`. */
  add(node: HostMesh): void;
  remove(node: HostMesh): void;
  clear(): void;
};

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

/**
 * A node of the host graph as a walk sees it: its identity, its local pose, the world matrix
 * the host resolved for it, and its chain. The engine computes its OWN world matrices from the
 * local poses (`../world/tree.ts`); `matrixWorld` is read where the HOST's own resolution is
 * what a boundary hands back to it.
 *
 * WHY `HostPlaced` (`../resources.ts`) ALSO DESCRIBES A POSED NODE. The two are not a copy: they
 * are keyed on the two different resolutions a host offers. `HostPlaced` asks for
 * `updateWorldMatrix(ancestors, descendants)` — the chain of ONE node, what a placement and a
 * visibility walk climb; this one asks for `updateMatrixWorld(force)` — the SUBTREE under a node,
 * what a scan, a bounds union and a replication resolve in one call. A host offering only one of
 * the two satisfies only the contract it answers, so neither may stand for the other.
 */
export interface HostGraphNode extends HostNode {
  /** Its parent. */
  readonly parent: HostGraphNode | null;
  /** Where it stands. */
  readonly position: HostVector;
  /**
   * The two faces of a node's rotation — the quaternion the engine compares, and the Euler
   * angles that copy into it — each ANNOUNCING its own writes: a callback the host already
   * chains, which a hook extends instead of replacing (`hooks.ts`). The two
   * underscored members are a private of the host's library, so they are written here, where
   * the hook needs them, and are given no name of their own. That keeps the private out of the
   * SDK's list of published contracts; it does NOT keep it out of the published surface, since
   * `HostGraphNode` carries it. Comparing the pose per frame, as the scan already does, is what
   * would remove the coupling — it is not this lot's.
   */
  readonly quaternion: HostRotation & {
    _onChangeCallback: () => void;
    _onChange(callback: () => void): unknown;
  };
  /** How it is turned, as angles. */
  readonly rotation: {
    _onChangeCallback: () => void;
    _onChange(callback: () => void): unknown;
  };
  /** How it is stretched. */
  readonly scale: HostVector;
  /** False when the host set `matrix` itself: the matrix IS the pose and nothing recomposes it. */
  matrixAutoUpdate: boolean;
  /** Its local matrix. */
  readonly matrix: HostNodeMatrix;
  /** Its world matrix. */
  readonly matrixWorld: HostNodeMatrix;
  /** Where the engine marks a copy of its own, which the host has never seen and cannot write. */
  readonly userData: Record<string, unknown>;
  /** The subtree under the node, itself first, in the host's own order. */
  traverse(visit: (node: HostGraphNode) => void): void;
  /** Resolves the world matrices of the subtree IN THE HOST GRAPH, for the host's own readers. */
  updateMatrixWorld(force?: boolean): void;
}

/** A node the engine adds copies to: the group a replication hangs its instances on. */
export type HostGraphGroup = HostGraphNode & { add(child: HostGraphNode): unknown };

/** A surface of the walked graph: one material or one per geometry group, and the geometry. */
export interface HostGraphMesh extends HostGraphNode {
  /** Raised by the host on the nodes it draws: what a walk keeps of a subtree. */
  readonly isMesh?: boolean;
  readonly geometry: HostGraphGeometry;
  readonly material: HostGraphMaterial | HostGraphMaterial[];
}

/** A node that bounds itself, or whose geometry does: the two boxes the bounds rule reads
 *  (`../world/bounds.ts`), the node's own winning over its geometry's as the reference does. */
export type HostBoundedNode = HostGraphNode & {
  readonly geometry?: HostGraphGeometry;
  boundingBox?: HostBox | null;
  computeBoundingBox?(): void;
};

/** A light of the host graph, with the numbers every kind of light declares of its own. A watch
 *  compares them per frame: they are the node's own data fields, which no hook may sit on. */
export type HostLightNode = HostGraphNode & {
  /** Raised by the host on the nodes its renderer lights the scene with. */
  readonly isLight?: boolean;
  readonly color: HostColour;
  readonly intensity: number;
  readonly distance?: number;
  readonly decay?: number;
  readonly angle?: number;
  readonly penumbra?: number;
  readonly groundColor?: HostColour;
  /** The node a directional or spot light aims at: another chain of ancestors to watch. */
  readonly target?: HostGraphNode;
};
