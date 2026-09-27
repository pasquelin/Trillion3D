// A bare node, a group and a mesh are the core's own classes, with no kind (`./kinds.ts`).
/** What a node of the graph is: the root, an eye, or one of the lights a scene declares. */
export type GraphNodeKind = 'scene' | 'camera' | GraphLightKind | 'ambient' | 'rect' | 'probe';
/** The kinds of light that aim or reach, named as the core's light declaration names them. */
export type GraphLightKind = 'directional' | 'point' | 'spot';
