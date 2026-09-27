/** The kinds a node of the engine's graph is told apart by (`./kinds.ts`): a bare node, a group
 *  and a mesh are the core's own `Object3D`, `Group`, `Mesh` and `InstancedMesh`, with no kind. */
/** What a node of the graph is: the root, an eye, or one of the lights a scene declares. */
export type GraphNodeKind = 'scene' | 'camera' | GraphLightKind | 'ambient' | 'rect' | 'probe';
/** The kinds of light that aim or reach, named as the core's light declaration names them. */
export type GraphLightKind = 'directional' | 'point' | 'spot';
