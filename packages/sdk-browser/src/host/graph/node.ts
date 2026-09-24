/**
 * THE ENGINE'S OWN SCENE GRAPH: the nodes a prepared scene, a world and the explorer are built
 * of — a bare node, a group, a mesh, a camera and the three kinds of light a scene declares.
 *
 * The engine READS a host graph by shape (`../scene/graphNodes.ts`, `../resources.ts`), and any
 * object of that shape satisfies it: these are the objects the engine BUILDS to that shape, so no
 * rendering library is needed to make one. The pose, the matrices and the hierarchy are the
 * core's `Object3D`, held in its transform tree, the reference's rules number for number; a node
 * here adds only what the engine reads of it — its `kind` and the reference's copy. A renderer
 * that needs its own library's objects receives a copy made at its boundary (the witnesses'
 * `bench/witnesses/three/fromGraph.ts`), never one of these.
 */
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { GraphNodeKind } from './nodeKind.ts';
export type { GraphLightKind, GraphNodeKind } from './nodeKind.ts';

/** Numbered from one, like every node of a session. */
let nextSerial = 1;

/** A node of the graph: the core's node, told apart by its `kind`, copied as the reference copies. */
export class GraphNode extends Object3D {
  /** The node's number in creation order: a diagnostic seeds a colour with it, a draw breaks ties. */
  readonly serial = nextSerial++;
  /** What the node is: what every reader of the graph narrows on. */
  readonly kind: GraphNodeKind = 'node';
  /** The node holding this one. */
  override get parent(): GraphNode | null {
    return super.parent as GraphNode | null;
  }
  /** The nodes this one holds, in order. */
  override get children(): readonly GraphNode[] {
    return super.children as readonly GraphNode[];
  }
  /** Calls `visit` on this node, then on every node below it, in order. */
  override traverse(visit: (node: GraphNode) => void) {
    super.traverse(visit as (node: Object3D) => void);
  }
  /** A node of the same kind with the same values; its children copied too unless told not. */
  override clone(recursive = true): this {
    return this.blank().copy(this, recursive);
  }
  /** An empty node of this kind, what `clone` fills. */
  protected blank(): this {
    return new GraphNode() as this;
  }
  /** Takes `source`'s values, and copies of its children unless told not to. */
  override copy(source: GraphNode, recursive = true) {
    this.name = source.name;
    this.up.copy(source.up);
    this.position.copy(source.position);
    this.rotation.order = source.rotation.order;
    this.quaternion.copy(source.quaternion);
    this.scale.copy(source.scale);
    this.matrix.copy(source.matrix);
    this.matrixWorld.copy(source.matrixWorld);
    this.matrixAutoUpdate = source.matrixAutoUpdate;
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
