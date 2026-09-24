/**
 * THE ENGINE'S OWN SCENE GRAPH: the nodes a prepared scene, a world and the explorer are built
 * of. A bare node and a group are the core's own `Object3D` and `Group`; the classes here add
 * only what the engine reads of the nodes that draw, look or light — their `kind`, their number
 * and the reference's copy.
 *
 * The engine READS a host graph by shape (`../scene/graphNodes.ts`, `../resources.ts`), and any
 * object of that shape satisfies it: these are the objects the engine BUILDS to that shape, so no
 * rendering library is needed to make one. The pose, the matrices and the hierarchy are the
 * core's `Object3D`, held in its transform tree, the reference's rules number for number. A
 * renderer that needs its own library's objects receives a copy made at its boundary (the
 * witnesses' `bench/witnesses/three/fromGraph.ts`), never one of these.
 */
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { GraphNodeKind } from './nodeKind.ts';
export type { GraphLightKind, GraphNodeKind } from './nodeKind.ts';

/** The next node's number, from one. */
let nextSerial = 1;

/** A node of the graph: the core's node, told apart by its `kind`, copied as the reference copies. */
export abstract class GraphNode extends Object3D {
  // In creation order: a diagnostic seeds a colour with it, a draw breaks ties with it.
  /** The node's number, unique in the session. */
  readonly serial = nextSerial++;
  /** What the node is: what every reader of the graph narrows on. */
  abstract readonly kind: GraphNodeKind;
  /** A node of the same kind with the same values; its children copied too unless told not. */
  override clone(recursive = true): this {
    return this.blank().copy(this, recursive);
  }
  /** An empty node of this kind, what `clone` fills. */
  protected abstract blank(): this;
  /** Takes `source`'s values, and copies of its children unless told not to. */
  override copy(source: Object3D, recursive = true) {
    return copyNode(this, source, recursive);
  }
}

/** A copy of any node of the graph, as the reference copies it: a node of the engine's own kind
 *  by its `clone`, a group or a bare node of the core's with the same values. */
export function cloneNode(node: Object3D, recursive = true): Object3D {
  if (node instanceof GraphNode) return node.clone(recursive);
  return copyNode(node instanceof Group ? new Group() : new Object3D(), node, recursive);
}

/** Writes `source`'s pose and flags into `into`, and copies of its children unless told not to. */
function copyNode<T extends Object3D>(into: T, source: Object3D, recursive: boolean): T {
  into.name = source.name;
  into.up.copy(source.up);
  into.position.copy(source.position);
  into.rotation.order = source.rotation.order;
  into.quaternion.copy(source.quaternion);
  into.scale.copy(source.scale);
  into.matrix.copy(source.matrix);
  into.matrixWorld.copy(source.matrixWorld);
  into.matrixAutoUpdate = source.matrixAutoUpdate;
  into.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
  into.visible = source.visible;
  into.castShadow = source.castShadow;
  into.receiveShadow = source.receiveShadow;
  into.frustumCulled = source.frustumCulled;
  into.renderOrder = source.renderOrder;
  into.userData = JSON.parse(JSON.stringify(source.userData)) as Record<string, unknown>;
  if (recursive) for (const child of source.children) into.add(cloneNode(child));
  return into;
}
