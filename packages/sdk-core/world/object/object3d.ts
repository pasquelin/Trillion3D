import { SceneNode } from '../../sceneNode.ts';
import { createSceneRoot } from '../../sceneRoot.ts';
import { lookAtNode } from '../../mathTransformTreeLookAt.ts';
import { Vector3 } from '../math/vector3.ts';
import { Euler } from '../math/euler.ts';
import { Quaternion } from '../math/quaternion.ts';
import { Matrix4 } from '../math/matrix4.ts';
import { listen } from '../math/observed.ts';
import type { Box3 } from '../math/box3.ts';

/** What a node reports to the world it hangs in: a pose moved, the tree changed, a content changed. */
export interface SceneLink {
  pose(node: Object3D): void;
  structure(node: Object3D): void;
  content(node: Object3D): void;
}

/** The one transform hierarchy every scene object is a node of (`sceneNode.ts`): a node made
 *  on its own is a detached root of it, and `add` reparents it there. */
const space = createSceneRoot({ id: 'world-objects' });
const aim = new Vector3();

/**
 * A node of the scene, as a page writes it: `position`, `rotation`, `quaternion` and `scale` are
 * live values whose writes land in the engine's transform tree, and reach the world it is in.
 */
export class Object3D extends SceneNode {
  readonly isObject3D = true as const;
  type = 'Object3D';
  name = '';
  readonly position = new Vector3();
  readonly rotation = new Euler();
  readonly quaternion = new Quaternion();
  readonly scale = new Vector3(1, 1, 1);
  readonly up = new Vector3(0, 1, 0);
  castShadow = false;
  receiveShadow = false;
  renderOrder = 0;
  userData: Record<string, unknown> = {};
  /** The world this node is drawn by; set on attach, cleared on detach. */
  _link: SceneLink | null = null;
  private readonly local = new Matrix4();
  private readonly world = new Matrix4();

  constructor() {
    const slot = space.reserve();
    super(slot.state, slot.id, slot.index, slot.visible);
    space.register(this);
    const pose = () => this._link?.pose(this);
    listen(this.position, () => {
      this.setPosition(this.position.x, this.position.y, this.position.z);
      pose();
    });
    listen(this.scale, () => {
      this.setScale(this.scale.x, this.scale.y, this.scale.z);
      pose();
    });
    listen(this.quaternion, () => {
      const q = this.quaternion;
      this.setQuaternion(q.x, q.y, q.z, q.w);
      this.rotation.setFromQuaternion(q, undefined, true);
      pose();
    });
    listen(this.rotation, () => this.quaternion.setFromEuler(this.rotation));
  }
  override get visible() {
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
  /** Local matrix, a view of this node's slot of the transform tree. */
  get matrix(): Matrix4 {
    this.local.elements = this.localMatrix as Float64Array;
    return this.local;
  }
  /** World matrix as last composed (`updateMatrixWorld`), a view of the tree. */
  get matrixWorld(): Matrix4 {
    this.world.elements = this.worldMatrix as Float64Array;
    return this.world;
  }
  /** A viewer looks down `-z`: cameras and lights say so. */
  protected get looksDownNegativeZ() {
    return false;
  }
  override add(...objects: Object3D[]) {
    for (const object of objects) {
      if (object === this) continue;
      super.add(object);
      object.traverse((node) => (node._link = this._link));
    }
    this._link?.structure(this);
    return this;
  }
  override remove(...objects: Object3D[]) {
    for (const object of objects) {
      if (object.parent !== this) continue;
      super.remove(object);
      object.traverse((node) => (node._link = null));
    }
    this._link?.structure(this);
    return this;
  }
  removeFromParent() {
    this.parent?.remove(this);
    return this;
  }
  override clear() {
    return this.remove(...this.children);
  }
  traverse(fn: (node: Object3D) => void) {
    fn(this);
    for (const child of this.children) child.traverse(fn);
  }
  traverseVisible(fn: (node: Object3D) => void) {
    if (!this.visible) return;
    fn(this);
    for (const child of this.children) child.traverseVisible(fn);
  }
  getObjectByName(name: string): Object3D | undefined {
    if (this.name === name) return this;
    for (const child of this.children) {
      const found = child.getObjectByName(name);
      if (found) return found;
    }
    return undefined;
  }
  /** Composes this node's world matrix and its descendants', the parent's taken as it stands. */
  updateMatrixWorld(_force?: boolean) {
    this.updateWorldMatrix(false, true);
  }
  /** Turns the node toward a world point (`lookAtNode`): `+z` at it, `-z` for a viewer. */
  lookAt(x: number | { x: number; y: number; z: number }, y = 0, z = 0) {
    if (typeof x === 'number') aim.set(x, y, z);
    else aim.copy(x);
    const tree = this.state.tree;
    lookAtNode(tree, this.index, aim.x, aim.y, aim.z, this.up.elements, this.looksDownNegativeZ);
    this.quaternion.fromArray(tree.quaternion, this.index * 4);
  }
  rotateOnAxis(axis: { x: number; y: number; z: number }, angle: number) {
    this.quaternion.multiply(new Quaternion().setFromAxisAngle(axis, angle));
    return this;
  }
  rotateX(angle: number) {
    return this.rotateOnAxis({ x: 1, y: 0, z: 0 }, angle);
  }
  rotateY(angle: number) {
    return this.rotateOnAxis({ x: 0, y: 1, z: 0 }, angle);
  }
  rotateZ(angle: number) {
    return this.rotateOnAxis({ x: 0, y: 0, z: 1 }, angle);
  }
  translateOnAxis(axis: { x: number; y: number; z: number }, distance: number) {
    const along = new Vector3(axis.x, axis.y, axis.z).applyQuaternion(this.quaternion);
    this.position.addScaledVector(along, distance);
    return this;
  }
  getWorldPosition(out = new Vector3()) {
    this.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.matrixWorld);
  }
  getWorldQuaternion(out = new Quaternion()) {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(new Vector3(), out, new Vector3());
    return out;
  }
  getWorldDirection(out = new Vector3()) {
    const q = this.getWorldQuaternion();
    return out.set(0, 0, this.looksDownNegativeZ ? -1 : 1).applyQuaternion(q);
  }
  localToWorld(v: Vector3) {
    this.updateWorldMatrix(true, false);
    return v.applyMatrix4(this.matrixWorld);
  }
  worldToLocal(v: Vector3) {
    this.updateWorldMatrix(true, false);
    return v.applyMatrix4(this.matrixWorld.clone().invert());
  }
  /** The box of this node's own content, local frame; a plain node holds none. */
  localBounds(): Box3 | null {
    return null;
  }
}

/** A node that only groups others. */
export class Group extends Object3D {
  readonly isGroup = true as const;
  override type = 'Group';
}
