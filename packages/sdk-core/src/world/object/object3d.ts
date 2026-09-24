import { TransformNode } from './transformNode.ts';
import { collectSlot, reserveSlot, uncollectSlot } from './objectSpace.ts';
import { lookAtNode } from '../../math/transform-tree/lookAt.ts';
import * as read from '../../math/transform-tree/read.ts';
import { Vector3 } from '../math/vector3.ts';
import { Euler } from '../math/euler.ts';
import { Quaternion } from '../math/quaternion.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { listen } from '../math/observed.ts';
import type { Box3 } from '../math/box3.ts';
import type { SceneLink } from './sceneLink.ts';
export type { SceneLink } from './sceneLink.ts';

/** Scratch values of the pose methods below — the world reads too: none of them allocates. */
const aim = new Vector3(),
  turn = new Quaternion(),
  along = new Vector3(),
  inverse = new Matrix4(),
  applied = new Matrix4(),
  at = new Float64Array(4);

/** A node of the scene, as a page writes it: `position`, `rotation`, `quaternion` and `scale` are
 *  live values whose writes land in the engine's transform tree, and reach the world it is in. */
export class Object3D extends TransformNode {
  /** Always `true`: tells a scene node apart. */ readonly isObject3D = true as const;
  /** The kind of node: `'Mesh'`, `'Group'`… */ type = 'Object3D';
  /** A name to find the node by. */ name = '';
  /** Where the node stands, from its parent. */ readonly position = new Vector3();
  /** How the node is turned, as three angles. */ readonly rotation = new Euler();
  /** How the node is turned, as a quaternion. */ readonly quaternion = new Quaternion();
  /** How the node is stretched on each axis. */ readonly scale = new Vector3(1, 1, 1);
  /** Which way is up for `lookAt`. */ readonly up = new Vector3(0, 1, 0);
  /** Whether the node casts shadows. */ castShadow = false;
  /** Whether shadows fall on the node. */ receiveShadow = false;
  /** Drawing order among see-through things. */ renderOrder = 0;
  /** Whether a renderer may skip it outside the view. */ frustumCulled = true;
  /** Free room for the page's own data. */ userData: Record<string, unknown> = {};
  /** The world this node is drawn by; set on attach, cleared on detach. */
  _link: SceneLink | null = null;
  constructor() {
    const slot = reserveSlot();
    super(slot.state, slot.id, slot.index, slot.visible);
    collectSlot(this, slot);
    const pose = () => this._link?.pose(this);
    listen(this.position, () => {
      this.setPosition(this.position.x, this.position.y, this.position.z);
      pose();
    });
    listen(this.scale, () => {
      this.setScale(this.scale.x, this.scale.y, this.scale.z);
      pose();
    });
    /** Written angles stay as written (`object3d.test.ts`); a quaternion write re-derives them. */
    const turned = (fromAngles: boolean) => {
      const q = fromAngles ? this.quaternion.setFromEuler(this.rotation, true) : this.quaternion;
      this.setQuaternion(q.x, q.y, q.z, q.w);
      if (fromAngles) this.rotation._follow(q);
      pose();
    };
    this.rotation._follow(this.quaternion);
    listen(this.quaternion, () => turned(false));
    listen(this.rotation, () => turned(true));
  }
  /** A node's transform tree, for an owner placing nodes by the thousand (`_link.posed`). */
  static _treeOf(node: Object3D) {
    return node.state.tree;
  }
  /** Whether the node and its children are drawn. */ override get visible() {
    return super.visible;
  }
  override set visible(value: boolean) {
    super.visible = value;
    this._link?.pose(this);
  }
  override get parent(): Object3D | null {
    return super.parent as Object3D | null;
  }
  override get children(): readonly Object3D[] {
    return super.children as readonly Object3D[];
  }
  /** A viewer looks down `-z`: cameras and lights say so. */
  protected get looksDownNegativeZ() {
    return false;
  }
  /** Makes objects children of this node. */ override add(...objects: Object3D[]) {
    for (const object of objects) {
      if (object === this) continue;
      super.add(object);
      object.traverse((node) => (node._link = this._link));
    }
    this._link?.structure(this);
    return this;
  }
  /** Takes children off this node. */ override remove(...objects: Object3D[]) {
    for (const object of objects) {
      if (object.parent !== this) continue;
      super.remove(object);
      object.traverse((node) => (node._link = null));
    }
    this._link?.structure(this);
    return this;
  }
  /** Frees the node and all below it now, rather than when they are collected. */
  override destroy() {
    this.traverse(uncollectSlot);
    super.destroy();
  }
  /** Takes the node off its parent. */ removeFromParent() {
    this.parent?.remove(this);
    return this;
  }
  /** Takes every child off this node. */ override clear() {
    return this.remove(...this.children);
  }
  /** Calls `fn` on this node and all below it. */ traverse(fn: (node: Object3D) => void) {
    fn(this);
    for (const child of this.children) child.traverse(fn);
  }
  /** Calls `fn` on each visible node from here down. */
  traverseVisible(fn: (node: Object3D) => void) {
    if (!this.visible) return;
    fn(this);
    for (const child of this.children) child.traverseVisible(fn);
  }
  /** The first node below with this name. */ getObjectByName(name: string): Object3D | undefined {
    if (this.name === name) return this;
    for (const child of this.children) {
      const found = child.getObjectByName(name);
      if (found) return found;
    }
    return undefined;
  }
  /** Composes the local matrix from the pose. */
  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.matrixWorldNeedsUpdate = true;
  }
  /** Applies `m` on top of the node's pose, then reads the pose back out of the product. */
  applyMatrix4(m: { elements: ArrayLike<number> }) {
    if (this.matrixAutoUpdate) this.updateMatrix();
    this.matrix.premultiply(applied.fromArray(m.elements));
    this.matrix.decompose(this.position, this.quaternion, this.scale);
  }
  /** Turns the node toward a world point (`lookAtNode`): `+z` at it, `-z` for a viewer. */
  lookAt(x: number | { x: number; y: number; z: number }, y = 0, z = 0) {
    if (typeof x === 'number') aim.set(x, y, z);
    else aim.copy(x);
    const tree = this.state.tree;
    lookAtNode(tree, this.index, aim.x, aim.y, aim.z, this.up.elements, this.looksDownNegativeZ);
    this.quaternion.fromArray(tree.quaternion, this.index * 4);
  }
  /** Turns the node around `axis` by `angle` radians. */
  rotateOnAxis(axis: { x: number; y: number; z: number }, angle: number) {
    this.quaternion.multiply(turn.setFromAxisAngle(axis, angle));
    return this;
  }
  /** Turns the node around its own x axis. */ rotateX(angle: number) {
    return this.rotateOnAxis({ x: 1, y: 0, z: 0 }, angle);
  }
  /** Turns the node around its own y axis. */ rotateY(angle: number) {
    return this.rotateOnAxis({ x: 0, y: 1, z: 0 }, angle);
  }
  /** Turns the node around its own z axis. */ rotateZ(angle: number) {
    return this.rotateOnAxis({ x: 0, y: 0, z: 1 }, angle);
  }
  /** Moves the node along its own `axis`. */
  translateOnAxis(axis: { x: number; y: number; z: number }, distance: number) {
    along.set(axis.x, axis.y, axis.z).applyQuaternion(this.quaternion);
    this.position.addScaledVector(along, distance);
    return this;
  }
  /** Where the node stands in the world. */ getWorldPosition(out = new Vector3()) {
    return out.fromArray(read.nodeWorldPosition(at, this.state.tree, this.index));
  }
  /** How the node is turned in the world. */ getWorldQuaternion(out = new Quaternion()) {
    return out.fromArray(read.nodeWorldQuaternion(at, this.state.tree, this.index));
  }
  /** The way the node faces in the world. */ getWorldDirection(out = new Vector3()) {
    const d = read.nodeWorldDirection(at, this.state.tree, this.index, this.looksDownNegativeZ);
    return out.set(d[0], d[1], d[2]);
  }
  /** A point of the node's frame, in the world. */ localToWorld(v: Vector3) {
    this.updateWorldMatrix(true, false);
    return v.applyMatrix4(this.matrixWorld);
  }
  /** A point of the world, in the node's frame. */ worldToLocal(v: Vector3) {
    this.updateWorldMatrix(true, false);
    return v.applyMatrix4(inverse.copy(this.matrixWorld).invert());
  }
  /** The box of this node's own content, local frame; a plain node holds none. */
  localBounds(): Box3 | null {
    return null;
  }
}

/** A node that only groups others. */
export class Group extends Object3D {
  /** Always `true`: tells a group apart. */ readonly isGroup = true as const;
  /** The kind of node, `'Group'`. */ override type = 'Group';
}
