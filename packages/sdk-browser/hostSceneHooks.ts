import type * as THREE from 'three';
import { bump, hookVector, type Hook, type WriteRevision } from './hostSceneHookCore.ts';

const hooks = new WeakMap<object, Hook>();

/**
 * The rotation, whichever of its two faces the host writes. The reference's quaternion and
 * Euler each announce their writes through a callback the object already chains for the other
 * face; the hook is added after it. An Euler write copies itself into the quaternion without
 * announcing there, so both faces are listened to, and both compare the quaternion: a write
 * that leaves the four numbers as they were bumps nothing.
 */
function hookRotation(node: THREE.Object3D, hook: Hook) {
  const q = node.quaternion;
  let x = q.x,
    y = q.y,
    z = q.z,
    w = q.w;
  const note = () => {
    if (q.x === x && q.y === y && q.z === z && q.w === w) return;
    x = q.x;
    y = q.y;
    z = q.z;
    w = q.w;
    bump(hook);
  };
  for (const face of [q, node.rotation]) {
    const previous = face._onChangeCallback;
    face._onChange(() => {
      previous.call(face);
      note();
    });
  }
}

/**
 * Hooks the local pose of `node` — position, scale, rotation — once in its life, and registers
 * `revision` among what its writes bump: a write of another value costs the host one comparison
 * and one increment, and a frame that reads nothing else knows the node did not move. The other
 * fields the contract lets the host write are the node's own data fields, which no hook may
 * touch without slowing the reference's walk: `hostSceneScan.ts` compares them per frame.
 */
export function hookHostNode(node: THREE.Object3D, revision: WriteRevision) {
  const known = hooks.get(node);
  if (known) {
    if (!known.revisions.includes(revision)) known.revisions.push(revision);
    return;
  }
  const hook: Hook = { revisions: [revision] };
  hooks.set(node, hook);
  hookVector(node, 'position', hook);
  hookVector(node, 'scale', hook);
  hookRotation(node, hook);
}

/** Forgets `revision` on `node`: its writes no longer bump it. The hooks stay, bumping nothing
 *  once the last watch has left: an object the host keeps a reference to is never swapped back. */
export function unhookHostNode(node: THREE.Object3D, revision: WriteRevision) {
  const hook = hooks.get(node);
  const at = hook ? hook.revisions.indexOf(revision) : -1;
  if (hook && at >= 0) hook.revisions.splice(at, 1);
}
