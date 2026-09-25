/** The kinds a node of the engine's graph is told apart by (`./kinds.ts`): a bare node and a
 *  group are the core's own `Object3D` and `Group`, with no kind. */
/** What a node of the graph is: the root, a drawn mesh (at one placement or several), an eye, or
 *  one of the lights a scene declares. */
export type GraphNodeKind =
  'scene' | 'mesh' | 'instancedMesh' | 'camera' | GraphLightKind | 'ambient' | 'rect' | 'probe';
/** The kinds of light that aim or reach, named as the core's light declaration names them. */
export type GraphLightKind = 'directional' | 'point' | 'spot';
