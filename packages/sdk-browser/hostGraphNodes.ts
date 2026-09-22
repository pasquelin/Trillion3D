/**
 * THE HOST SCENE GRAPH, NAMED BY SHAPE.
 *
 * `hostResources.ts` names what a host hands the engine to READ — a material, a texture, a
 * geometry, a node held by identity. This file names the same graph as the engine WALKS: the
 * local pose it reads to compute a world matrix of its own, the fields a watch compares frame
 * after frame, the ancestors a chain climbs and the write a boundary sets back on a node the
 * host asked to move. The two files split one vocabulary by responsibility; neither names a
 * rendering library, and any host object of the same shape satisfies them.
 *
 * Building one of these objects is not reading it: the boundary that makes a host node, a host
 * camera or a copy of a host mesh is `hostGraphObjects.ts`, the only file of the walk allowed
 * to name the library its host wrote them with.
 */
import type { GpuBuffer } from './clusterBatchMesh.ts';
import type {
  HostAttribute,
  HostBox,
  HostColour,
  HostDisposable,
  HostGeometry,
  HostMaterial,
  HostNode,
  HostTexture,
} from './hostResources.ts';

/** Three numbers of a pose, as the host stores them and a boundary sets them back. */
export type HostVector = {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): unknown;
};

/** The orientation of a pose, as the host stores it: `(x, y, z, w)`. */
export type HostRotation = {
  x: number;
  y: number;
  z: number;
  w: number;
  set(x: number, y: number, z: number, w: number): unknown;
};

/**
 * One face of a node's rotation — the quaternion, or the Euler angles that copy into it — as it
 * announces its own writes: a callback the host already chains, which a hook extends instead of
 * replacing (`hostSceneHooks.ts`).
 */
export type HostAnnounced = {
  _onChangeCallback: () => void;
  _onChange(callback: () => void): unknown;
};

/**
 * A 4×4 a node carries, column-major. Its sixteen floats are read as they stand and written
 * term by term by the boundary that poses the node; nothing asks the host to compose them.
 */
export type HostNodeMatrix = {
  readonly elements: { [index: number]: number; readonly length: number };
};

/** A geometry of the walked graph: the local box it can compute on demand, the index its
 *  triangles are drawn through, and the release its host expects. */
export type HostGraphGeometry = HostGeometry &
  HostDisposable & {
    computeBoundingBox(): void;
    /** Triangle list of the geometry, with what an upload compares to skip a re-copy. */
    readonly index: (HostAttribute & GpuBuffer) | null;
  };

/** A surface of the walked graph: what the engine reads of it, and the release its host expects. */
export type HostGraphMaterial = HostMaterial & HostDisposable;

/** A texture of the walked graph: the host resource itself, released with the surface that
 *  sampled it, and the sampling quality a session raises to what the device allows. */
export type HostGraphTexture = Omit<HostTexture, 'anisotropy'> &
  HostDisposable & {
    anisotropy: number;
    /** Raised when a sampler field changed: what tells the host to upload it again. */
    needsUpdate: boolean;
  };

/**
 * A node of the host graph as a walk sees it: its identity, its local pose, the world matrix
 * the host resolved for it, and its chain. The engine computes its OWN world matrices from the
 * local poses (`hostWorldTree.ts`); `matrixWorld` is read where the HOST's own resolution is
 * what a boundary hands back to it.
 */
export interface HostGraphNode extends HostNode {
  readonly parent: HostGraphNode | null;
  readonly position: HostVector;
  readonly quaternion: HostRotation & HostAnnounced;
  readonly rotation: HostAnnounced;
  readonly scale: HostVector;
  /** False when the host set `matrix` itself: the matrix IS the pose and nothing recomposes it. */
  matrixAutoUpdate: boolean;
  readonly matrix: HostNodeMatrix;
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
 *  (`hostWorldBounds.ts`), the node's own winning over its geometry's as the reference does. */
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
