/**
 * WHAT A NODE OF THE ENGINE'S GRAPH IS: the one test every reader of the graph narrows on — a
 * walk keeping the drawn nodes, the lighting keeping the lights, the view keeping the eye. A mesh
 * is told by its class, the core's `Mesh` or `InstancedMesh`; any other node by its `kind`. The
 * type a guard returns is the class the node is built by, so no reader has to assert what the
 * graph already says. A guard takes any object: a published display graph may be a witness's,
 * whose nodes are none of these.
 */
import type { GraphCamera } from './camera.ts';
import type { GraphAmbientLight, GraphLight, GraphLightProbe, GraphRectLight } from './light.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { InstancedMesh } from '../../../../sdk-core/src/world/object/instancedMesh.ts';
import type { HostInstancedMesh, HostMesh } from '../resources.ts';
import type { GraphScene } from './scene.ts';

/** The kind of a node, or `undefined` for an object that is not one of the graph's. */
const kindOf = (node: object) => ('kind' in node ? node.kind : undefined);

/** Every light of the graph, told apart by its `kind`. */
export type GraphAnyLight = GraphLight | GraphAmbientLight | GraphRectLight | GraphLightProbe;

/** The nodes a draw submits: a mesh of the core's at one placement, or at several. */
export const isDrawnNode = (node: object): node is HostMesh => node instanceof Mesh;

/** A mesh drawn at several placements. */
export const isInstancedNode = (node: object): node is HostInstancedMesh =>
  node instanceof InstancedMesh;

/** A light that aims or reaches: directional, point or spot. */
export const isPlacedLight = (node: object): node is GraphLight => {
  const kind = kindOf(node);
  return kind === 'directional' || kind === 'point' || kind === 'spot';
};

/** Any light: the three that aim or reach, the ambient, the rectangle and the probe. */
export const isLightNode = (node: object): node is GraphAnyLight => {
  const kind = kindOf(node);
  return isPlacedLight(node) || kind === 'ambient' || kind === 'rect' || kind === 'probe';
};

/** An eye. */
export const isCameraNode = (node: object): node is GraphCamera => kindOf(node) === 'camera';

/** The root of a display graph. */
export const isSceneNode = (node: object): node is GraphScene => kindOf(node) === 'scene';

/** A texture of the graph, whatever slot of a surface holds it. */
export { isGraphTexture } from './texture.ts';
