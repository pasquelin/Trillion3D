import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts';
import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { resolveCameraWorld } from '../camera/world.ts';
import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import { worldPoseOf } from './bodyFrame.ts';
import type { NodeMove } from './cookedBodies.ts';

/** Whether `node` is `ancestor` or lies under it. */
const under = (node: Object3D, ancestor: Object3D) => {
  let at: Object3D | null = node;
  while (at && at !== ancestor) at = at.parent;
  return at !== null;
};

const world = new Matrix4(),
  parent = new Matrix4(),
  at = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3();

/**
 * Poses `node` at the world pose `position[p]`, `quaternion[q]`, of world scale `scale[p]`: the
 * pose made local to its parent, which a node nested under others — a compiled model's, under
 * its ancestors and its model — is posed by. Its place and turn are written quietly, into its
 * numbers and the transform tree (`readPose`): its caller tells the world (`SceneLink.posed`),
 * and the physics hears nothing of its own write. Its scale, its body's, stays.
 */
function placeNode(
  node: Object3D,
  position: ArrayLike<number>,
  p: number,
  quaternion: ArrayLike<number>,
  q: number,
  scale: ArrayLike<number>,
) {
  at.set(position[p], position[p + 1], position[p + 2]);
  turn.set(quaternion[q], quaternion[q + 1], quaternion[q + 2], quaternion[q + 3]);
  world.compose(at, turn, size.set(scale[p], scale[p + 1], scale[p + 2]));
  if (node.parent) {
    parent.fromArray(resolveCameraWorld(node.parent).matrixWorld.elements);
    world.premultiply(parent.invert());
  }
  world.decompose(at, turn, size);
  node.position.elements.set(at.elements);
  node.quaternion.set(turn.x, turn.y, turn.z, turn.w, true);
  node.setPosition(at.x, at.y, at.z);
  node.setQuaternion(turn.x, turn.y, turn.z, turn.w);
}

/**
 * The slots of the placer (`placer.ts`) that pose a node nested under others: their world poses
 * kept in its `position`, `quaternion` and `scale`, by slot, each written as its node's local
 * pose (`placeNode`).
 */
export function createNestedNodes(
  position: Float64Array,
  quaternion: Float64Array,
  scale: Float64Array,
) {
  const nodes = new Map<number, Object3D>();
  /** Slot `index` drawn where its node `target` stands now. */
  const read = (index: number, target: Object3D) => {
    const pose = worldPoseOf(target);
    position.set(pose.position, index * 3);
    quaternion.set(pose.quaternion, index * 4);
  };
  return {
    /** Slot `index` poses `target`, of world scale `size`, from where it stands. */
    bind(index: number, target: Object3D, size: readonly number[]) {
      nodes.set(index, target);
      read(index, target);
      scale.set(size, index * 3);
    },
    /** Slot `index`'s pose written to its node: that node, which the world is to hear of. */
    place(index: number) {
      const node = nodes.get(index)!;
      placeNode(node, position, index * 3, quaternion, index * 4, scale);
      return node;
    },
    drop: (index: number) => void nodes.delete(index),
    /** `slots` sorted so each node comes after every ancestor of it among them (by depth). */
    order(slots: number[]) {
      const depth = (index: number) => {
        let d = 0;
        for (let at = nodes.get(index)!.parent; at; at = at.parent) d++;
        return d;
      };
      const depths = new Map(slots.map((index) => [index, depth(index)]));
      slots.sort((a, b) => depths.get(a)! - depths.get(b)!);
    },
    clear: () => nodes.clear(),
    /** `ancestor` moved (a page's move): each node under it, or it, is drawn from where it stands
     *  now, and `hold` keeps it there until its body's next tick, not back where its last tick was
     *  simulated before the move. */
    follow(ancestor: Object3D, hold: (index: number) => void) {
      for (const [index, node] of nodes) {
        if (!under(node, ancestor)) continue;
        read(index, node);
        hold(index);
      }
    },
  };
}

/**
 * The page moved `moved`: each compiled node a body moves (`nested`, by slot) that is it or lies
 * under it has its body put where it stands now, and is drawn from there (`follow`), not back
 * where its body's last tick left it.
 */
export function followMove(
  moved: Object3D,
  nested: ReadonlyMap<number, NodeMove>,
  writer: Pick<CommandWriter, 'teleport'>,
  follow: (node: Object3D) => void,
) {
  for (const [slot, { node }] of nested) {
    if (!under(node, moved)) continue;
    const now = worldPoseOf(node);
    writer.teleport(slot, now.position, now.quaternion);
  }
  follow(moved);
}
