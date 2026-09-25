/**
 * THE ENGINE'S OWN SCENE GRAPH: the nodes a prepared scene, a world and the explorer are built
 * of. A bare node and a group are the core's own `Object3D` and `Group`; the classes here add
 * only what the engine reads of the nodes that draw, look or light — their `kind`, their number
 * and how an empty one is made, which the core's `clone` fills.
 *
 * The engine READS a host graph by shape (`../scene/graphNodes.ts`, `../resources.ts`), and any
 * object of that shape satisfies it: these are the objects the engine BUILDS to that shape, so no
 * rendering library is needed to make one. The pose, the matrices and the hierarchy are the
 * core's `Object3D`, held in its transform tree, the reference's rules number for number. A
 * renderer that needs its own library's objects receives a copy made at its boundary (the
 * witnesses' `bench/witnesses/three/fromGraph.ts`), never one of these.
 */
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { GraphNodeKind } from './nodeKind.ts';
export type { GraphLightKind, GraphNodeKind } from './nodeKind.ts';

/** The next node's number, from one. */
let nextSerial = 1;

/** A node of the graph: the core's node, told apart by its `kind`, copied by the core's `clone`. */
export abstract class GraphNode extends Object3D {
  // In creation order: a diagnostic seeds a colour with it, a draw breaks ties with it.
  /** The node's number, unique in the session. */
  readonly serial = nextSerial++;
  /** What the node is: what every reader of the graph narrows on. */
  abstract readonly kind: GraphNodeKind;
  /** An empty node of this kind, what `clone` fills. */
  protected abstract override blank(): this;
}
