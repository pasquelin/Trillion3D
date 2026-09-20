import type * as THREE from 'three';
import {
  accessor,
  bump,
  hookTriple,
  XYZ,
  type Hook,
  type WriteRevision,
} from './hostSceneHookCore.ts';
import { hookLight, type HookedLight } from './hostSceneHooksLight.ts';
import { copyElements, sameElements } from './matrixElements.ts';

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
    hook.undo.push(() => face._onChange(previous));
  }
}

/**
 * A matrix set by hand, recomposition cut, has no setter to announce it. What the reference
 * asks of such a node is to raise its update flag — `updateMatrix()` does so itself — and that
 * raise is where the sixteen numbers are compared to the ones last seen: a set matrix is
 * announced once, a flag raised again over the same matrix announces nothing. The reference's
 * own walk clears the flag, which compares nothing; an automatic node keeps no snapshot, since
 * its pose is hooked field by field.
 */
function hookSetMatrix(node: THREE.Object3D, hook: Hook) {
  // Read at each write, never captured: the reference lets a host replace the matrix object.
  let held: Float64Array | null = node.matrixAutoUpdate
    ? null
    : Float64Array.from(node.matrix.elements);
  accessor(node, 'matrixAutoUpdate', hook, (auto) => {
    held = auto ? null : Float64Array.from(node.matrix.elements);
    bump(hook);
  });
  accessor(
    node,
    'matrixWorldNeedsUpdate',
    hook,
    (raised) => {
      const elements = node.matrix.elements;
      if (!raised || !held || sameElements(held, elements)) return;
      copyElements(held, elements);
      bump(hook);
    },
    true,
  );
}

/**
 * Hooks every write the contract lets the host make on `node`, once, and registers `revision`
 * among what those writes bump.
 *
 * The local pose — position, rotation, scale — visibility, the recomposition flag and the
 * parent are accessors of the instance from then on: a write of another value costs the host
 * one comparison and one increment, and a frame that reads nothing else knows the node did
 * not move. A matrix set by hand is announced by the update flag the reference has such a node
 * raise (`hookSetMatrix`). A reparented node changes its ancestor chain: the watched set is
 * reshaped.
 */
export function hookHostNode(node: THREE.Object3D, revision: WriteRevision) {
  const known = hooks.get(node);
  if (known) {
    if (!known.revisions.includes(revision)) known.revisions.push(revision);
    return;
  }
  const hook: Hook = { revisions: [revision], undo: [] };
  hooks.set(node, hook);
  hookTriple(node.position, XYZ, hook);
  hookTriple(node.scale, XYZ, hook);
  hookRotation(node, hook);
  accessor(node, 'visible', hook, () => bump(hook));
  accessor(node, 'parent', hook, () => bump(hook, true));
  hookSetMatrix(node, hook);
  if ((node as THREE.Light).isLight) hookLight(node as HookedLight, hook);
}

/** Forgets `revision` on `node`: its writes no longer bump it. The last one to leave takes every
 *  accessor with it, and the node is the host's plain object again. */
export function unhookHostNode(node: THREE.Object3D, revision: WriteRevision) {
  const hook = hooks.get(node);
  const at = hook ? hook.revisions.indexOf(revision) : -1;
  if (!hook || at < 0) return;
  hook.revisions.splice(at, 1);
  if (hook.revisions.length) return;
  for (let i = hook.undo.length - 1; i >= 0; i--) hook.undo[i]();
  hooks.delete(node);
}
