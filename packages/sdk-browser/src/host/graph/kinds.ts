/**
 * WHAT A NODE OF THE ENGINE'S GRAPH IS, READ FROM ITS `kind`: the one discriminant every reader
 * of the graph narrows on — a walk keeping the drawn nodes, the lighting keeping the lights, the
 * view keeping the eye. Each guard answers from `kind` alone, and the type it returns is the
 * class that kind is built by, so no reader has to assert what the graph already says. A guard
 * takes any object: a published display graph may be a witness's, whose nodes carry no `kind`
 * and are none of these.
 */
import type { GraphCamera } from './camera.ts';
import type { GraphAmbientLight, GraphLight, GraphLightProbe, GraphRectLight } from './light.ts';
import type { GraphInstancedMesh, GraphMesh } from './mesh.ts';
import type { GraphScene } from './scene.ts';

/** The kind of a node, or `undefined` for an object that is not one of the graph's. */
const kindOf = (node: object) => ('kind' in node ? node.kind : undefined);

/** Every light of the graph, told apart by its `kind`. */
export type GraphAnyLight = GraphLight | GraphAmbientLight | GraphRectLight | GraphLightProbe;

/** The nodes a draw submits: a mesh at one placement, or at several. */
export const isDrawnNode = (node: object): node is GraphMesh => {
  const kind = kindOf(node);
  return kind === 'mesh' || kind === 'instancedMesh';
};

/** A mesh drawn at several placements. */
export const isInstancedNode = (node: object): node is GraphInstancedMesh =>
  kindOf(node) === 'instancedMesh';

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
