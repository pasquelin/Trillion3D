/** The kinds a node of the engine's graph is told apart by (`./kinds.ts`). */
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
