/**
 * THE ENGINE'S OWN SCENE GRAPH: the nodes a prepared scene, a world and the explorer are built
 * of — a bare node, a group, a mesh, a camera and the three kinds of light a scene declares.
 *
 * The engine READS a host graph by shape (`../scene/graphNodes.ts`, `../resources.ts`), and any
 * object of that shape satisfies it: these are the objects the engine BUILDS to that shape, so no
 * rendering library is needed to make one. Every rule a reader relies on is the reference's, kept
 * number for number — the matrix composed from the pose (`composeMatrix4`), the world matrix
 * resolved down the chain, the copy a node shared by several parents becomes, the aim of a
 * camera — because the engine's image is proven by being the same image. The numbers are the
 * core's (`Matrix4`, `Color`, `lookAtQuaternion`); a renderer that needs its own library's objects
 * receives a copy made at its boundary (the witnesses' `bench/witnesses/three/fromGraph.ts`), never one of these.
 */
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { lookAtQuaternion } from '../../../../sdk-core/src/math/transform-tree/lookAt.ts';
import { GraphAngles, GraphRotation } from './rotation.ts';
import { GraphVector } from './vector.ts';

/** What a node of the graph is: a bare node, the root, a group, a drawn mesh (at one placement
 *  or several), an eye, or one of the lights a scene declares. */
export type GraphNodeKind =
  | 'node'
  | 'scene'
  | 'group'
  | 'mesh'
  | 'instancedMesh'
  | 'camera'
  | GraphLightKind
  | 'ambient'
  | 'rect'
  | 'probe';
/** The kinds of light that aim or reach, named as the core's light declaration names them. */
export type GraphLightKind = 'directional' | 'point' | 'spot';

/** Numbered from one, like every node of a session: a diagnostic seeds a colour with it. */
let nextId = 1;
/** Scratch of `lookAt`. */
const aim = new Float64Array(4);

/** A node of the graph: its name, its pose, its world matrix, its parent and its children. */
export class GraphNode {
  /** The node's number, unique in the session. */
  readonly id = nextId++;
  /** What the node is: what every reader of the graph narrows on. */
  readonly kind: GraphNodeKind = 'node';
  /** A name to find the node by. */
  name = '';
  /** The node holding this one. */
  parent: GraphNode | null = null;
  /** The nodes this one holds, in order. */
  readonly children: GraphNode[] = [];
  /** Which way is up for `lookAt`. */
  readonly up = new GraphVector(0, 1, 0);
  /** Where the node stands, from its parent. */
  readonly position = new GraphVector();
  /** How the node is turned, as three angles. */
  readonly rotation = new GraphAngles();
  /** How the node is turned, as a quaternion. */
  readonly quaternion = new GraphRotation();
  /** How the node is stretched on each axis. */
  readonly scale = new GraphVector(1, 1, 1);
  /** The local matrix: composed from the pose while `matrixAutoUpdate` holds. */
  readonly matrix = new Matrix4();
  /** The world matrix, as last resolved. */
  readonly matrixWorld = new Matrix4();
  /** False when `matrix` IS the pose and nothing recomposes it. */
  matrixAutoUpdate = true;
  /** False when nothing writes `matrixWorld`. */
  matrixWorldAutoUpdate = true;
  /** Set when the local matrix changed and the world matrix has not followed. */
  matrixWorldNeedsUpdate = false;
  /** Whether the node and its children are drawn. */
  visible = true;
  /** Whether it casts shadows. */
  castShadow = false;
  /** Whether shadows fall on it. */
  receiveShadow = false;
  /** Whether a renderer may skip it outside the view. */
  frustumCulled = true;
  /** Drawing order among see-through things. */
  renderOrder = 0;
  /** Free room for the data of whoever built the node. */
  userData: Record<string, unknown> = {};

  constructor() {
    // The two faces of the rotation follow each other, each without announcing the other.
    this.rotation._onChange(() => this.quaternion.setFromAngles(this.rotation, true));
    this.quaternion._onChange(() => this.rotation.setFromRotation(this.quaternion, true));
  }
  /** A viewer — a camera, a light — looks down its `-z`, an object presents its `+z`. */
  protected get looksDownNegativeZ() {
    return false;
  }
  /** Makes `nodes` children of this one, each taken off its previous parent first. */
  add(...nodes: GraphNode[]) {
    for (const node of nodes) {
      if (node === this) continue;
      node.removeFromParent();
      node.parent = this;
      this.children.push(node);
    }
    return this;
  }
  /** Takes `nodes` off this one. */
  remove(...nodes: GraphNode[]) {
    for (const node of nodes) {
      const at = this.children.indexOf(node);
      if (at < 0) continue;
      node.parent = null;
      this.children.splice(at, 1);
    }
    return this;
  }
  /** Takes this node off its parent. */
  removeFromParent() {
    this.parent?.remove(this);
    return this;
  }
  /** Takes every child off this node. */
  clear() {
    return this.remove(...this.children);
  }
  /** Calls `visit` on this node, then on every node below it, in order. */
  traverse(visit: (node: GraphNode) => void) {
    visit(this);
    for (const child of this.children) child.traverse(visit);
  }
  /** Composes the local matrix from the pose. */
  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }
  /** Resolves the world matrices of the subtree, this node's parent taken as it stands. */
  updateMatrixWorld(force = false) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate) this.resolveWorld();
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    for (const child of this.children)
      if (child.matrixWorldAutoUpdate || force) child.updateMatrixWorld(force);
  }
  /** Resolves this node's world matrix, its ancestors' first when asked, its subtree after. */
  updateWorldMatrix(ancestors: boolean, descendants: boolean) {
    if (ancestors && this.parent) this.parent.updateWorldMatrix(true, false);
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldAutoUpdate) this.resolveWorld();
    if (descendants)
      for (const child of this.children)
        if (child.matrixWorldAutoUpdate) child.updateWorldMatrix(false, true);
  }
  /** The world matrix from the parent's and the local one. */
  protected resolveWorld() {
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    else this.matrixWorld.copy(this.matrix);
  }
  /** Applies `m` on top of the node's pose, then reads the pose back out of the product. */
  applyMatrix4(m: { elements: ArrayLike<number> }) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    this.matrix.premultiply(new Matrix4().fromArray(m.elements));
    this.matrix.decompose(this.position, this.quaternion, this.scale);
  }
  /** Turns the node toward a world point, given as a point or as its three numbers. */
  lookAt(x: number | { x: number; y: number; z: number }, y = 0, z = 0) {
    const target = typeof x === 'number' ? { x, y, z } : x;
    this.updateWorldMatrix(true, false);
    lookAtQuaternion(
      aim,
      this.matrixWorld.elements,
      0,
      target.x,
      target.y,
      target.z,
      [this.up.x, this.up.y, this.up.z],
      this.looksDownNegativeZ,
      this.parent ? this.parent.matrixWorld.elements : null,
    );
    this.quaternion.set(aim[0], aim[1], aim[2], aim[3]);
  }
  /** A node of the same kind with the same values; its children copied too unless told not. */
  clone(recursive = true): this {
    return this.blank().copy(this, recursive);
  }
  /** An empty node of this kind, what `clone` fills. */
  protected blank(): this {
    return new GraphNode() as this;
  }
  /** Takes `source`'s values, and copies of its children unless told not to. */
  copy(source: GraphNode, recursive = true) {
    this.name = source.name;
    this.up.copy(source.up);
    this.position.copy(source.position);
    this.rotation._order = source.rotation._order;
    this.quaternion.copy(source.quaternion);
    this.scale.copy(source.scale);
    this.matrix.copy(source.matrix);
    this.matrixWorld.copy(source.matrixWorld);
    this.matrixAutoUpdate = source.matrixAutoUpdate;
    this.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
    this.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
    this.visible = source.visible;
    this.castShadow = source.castShadow;
    this.receiveShadow = source.receiveShadow;
    this.frustumCulled = source.frustumCulled;
    this.renderOrder = source.renderOrder;
    this.userData = JSON.parse(JSON.stringify(source.userData)) as Record<string, unknown>;
    if (recursive) for (const child of source.children) this.add(child.clone());
    return this;
  }
}
