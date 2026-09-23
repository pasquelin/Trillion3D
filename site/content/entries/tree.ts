import type { EntryNote } from '../model.ts';

/** The transform tree: the engine's scene graph, data-oriented. */

export const TREE: EntryNote[] = [
  {
    id: 'createTransformTree',
    replaces: 'new Object3D(), parent.add(child)',
  },
  {
    id: 'setNodePosition',
    replaces: 'Object3D.position.set, quaternion.set, scale.set, matrix.copy, matrixAutoUpdate',
  },
  {
    id: 'reparentTransformNode',
    replaces: 'Object3D.add, remove',
  },
  {
    id: 'updateNodeMatrixWorld',
    replaces: 'Object3D.updateMatrixWorld, updateWorldMatrix',
  },
  {
    id: 'nodeWorldPosition',
    replaces: 'getWorldPosition, getWorldQuaternion, getWorldScale, getWorldDirection',
  },
  {
    id: 'lookAtNode',
    replaces: 'Object3D.lookAt',
  },
];
