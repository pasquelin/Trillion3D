/**
 * WHAT A NODE OF THE ENGINE'S GRAPH IS: the one test every reader of the graph narrows on — a
 * walk keeping the drawn nodes, the lighting keeping the lights. A mesh is told by its class, the
 * core's `Mesh` or `InstancedMesh`; a light by the core's `Light`, and what it does by its `kind`.
 * The type a guard returns is the class the node is built by, so no reader has to assert what the
 * graph already says. A guard takes any object: a published display graph may be a witness's,
 * whose nodes are none of these.
 */
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { InstancedMesh } from '../../../../sdk-core/src/world/object/instancedMesh.ts';
import { Light } from '../../../../sdk-core/src/world/light/light.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { HostInstancedMesh, HostMesh } from '../resources.ts';

/** The nodes a draw submits: a mesh of the core's at one placement, or at several. */
export const isDrawnNode = (node: object): node is HostMesh => node instanceof Mesh;

/** A mesh drawn at several placements. */
export const isInstancedNode = (node: object): node is HostInstancedMesh =>
  node instanceof InstancedMesh;

/** Any light: the core's, whatever its kind. */
export const isLightNode = (node: object): node is Light => node instanceof Light;

/** A light that aims or reaches: directional, point or spot. */
export const isPlacedLight = (node: object): node is Light =>
  node instanceof Light &&
  (node.kind === 'directional' || node.kind === 'point' || node.kind === 'spot');

/** The node a directional or a spot light aims at; the other kinds aim at nothing, though every
 *  light of the core's holds a target. */
export const aimOf = (light: Light): Object3D | undefined =>
  light.kind === 'directional' || light.kind === 'spot' ? light.target : undefined;

/** A texture of the graph, whatever slot of a surface holds it. */
export { isGraphTexture } from './texture.ts';
