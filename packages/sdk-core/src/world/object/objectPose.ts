import { listen } from '../math/observed.ts';
import type { TransformTree } from '../../math/transform-tree/transformTree.ts';
import type { Object3D } from './object3d.ts';

/** Every write to `node`'s position, rotation, quaternion or scale lands in its slot of the
 *  transform tree and reaches the world that draws it. */
export function bindPose(node: Object3D) {
  const pose = () => node._link?.pose(node);
  listen(node.position, () => {
    node.setPosition(node.position.x, node.position.y, node.position.z);
    pose();
  });
  listen(node.scale, () => {
    node.setScale(node.scale.x, node.scale.y, node.scale.z);
    pose();
  });
  /** Written angles stay as written (`object3d.test.ts`); a quaternion write re-derives them. */
  const turned = (fromAngles: boolean) => {
    const q = fromAngles ? node.quaternion.setFromEuler(node.rotation, true) : node.quaternion;
    node.setQuaternion(q.x, q.y, q.z, q.w);
    if (fromAngles) node.rotation._follow(q);
    pose();
  };
  node.rotation._follow(node.quaternion);
  listen(node.quaternion, () => turned(false));
  listen(node.rotation, () => turned(true));
}

/** The other way, after the tree was written first (`attach`): `node`'s values take its slot's
 *  pose quietly, the angles following the quaternion when read, and the world hears it once. */
export function readPose(node: Object3D, tree: TransformTree) {
  const { position, quaternion, scale } = tree,
    at = node.index * 3,
    q = node.index * 4;
  for (let i = 0; i < 3; i++) {
    node.position.elements[i] = position[at + i];
    node.scale.elements[i] = scale[at + i];
  }
  node.quaternion.set(quaternion[q], quaternion[q + 1], quaternion[q + 2], quaternion[q + 3], true);
  node._link?.pose(node);
}
