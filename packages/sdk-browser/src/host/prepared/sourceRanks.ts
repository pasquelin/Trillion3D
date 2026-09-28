import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** Cache node identity is independent of names, draw order and host object allocation. */
const ranks = new WeakMap<Object3D, number>();
export const preparedNodeRank = (node: Object3D) => ranks.get(node);
export const registerPreparedNodeRank = (node: Object3D, rank: number) => ranks.set(node, rank);
