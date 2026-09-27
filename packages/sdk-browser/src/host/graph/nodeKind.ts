// A bare node, a group, a mesh, a scene and a camera are the core's own classes, with no kind
// (`./kinds.ts`).
/** What a light of the graph is: one of the lights a scene declares. */
export type GraphNodeKind = GraphLightKind | 'ambient' | 'rect' | 'probe';
/** The kinds of light that aim or reach, named as the core's light declaration names them. */
export type GraphLightKind = 'directional' | 'point' | 'spot';
