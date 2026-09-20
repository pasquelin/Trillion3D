import type * as THREE from 'three';
import {
  accessor,
  bump,
  bumpOwners,
  hookTriple,
  owners,
  XYZ,
  type Hook,
  type WriteRevision,
} from './hostSceneHookCore.ts';
import { hookLight, type HookedLight } from './hostSceneHooksLight.ts';

export type { WriteRevision } from './hostSceneHookCore.ts';

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
  const sub = owners(q, hook);
  if (!sub) return;
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
    bumpOwners(sub);
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
 * Hooks every write the contract lets the host make on `node`, once, and registers `revision`
 * among what those writes bump. Returns true when the registration is new.
 *
 * The local pose — position, rotation, scale — visibility, the recomposition flag and the
 * parent are accessors of the instance from then on: a write of another value costs the host
 * one comparison and one increment, and a frame that reads nothing else knows the node did
 * not move. A matrix set by hand is announced by the update flag the reference has such a node
 * write (`hookSetMatrix`). A reparented node changes its ancestor chain: the scene change it
 * announces rebuilds the watched set.
 */
export function hookHostNode(node: THREE.Object3D, revision: WriteRevision) {
  const known = hooks.get(node);
  if (known) {
    if (known.revisions.includes(revision)) return false;
    known.revisions.push(revision);
    return true;
  }
  const hook: Hook = { revisions: [revision] };
  hooks.set(node, hook);
  hookTriple(node.position, XYZ, hook);
  hookTriple(node.scale, XYZ, hook);
  hookRotation(node, hook);
  accessor(node, 'visible', () => bump(hook));
  accessor(node, 'parent', () => bump(hook));
  hookSetMatrix(node, hook);
  if ((node as THREE.Light).isLight) hookLight(node as HookedLight, hook);
  return true;
}

/**
 * A matrix set by hand, recomposition cut, has no setter to announce it. What the reference
 * asks of such a node is to write its update flag — `updateMatrix()` raises it, a forced
 * `updateMatrixWorld()` clears it — and that write is where the sixteen numbers are compared to
 * the ones last seen: a set matrix is announced once, a flag raised again over the same matrix
 * announces nothing. An automatic node keeps no snapshot: the reference raises its flag on its
 * own walk, every frame, and its pose is hooked field by field.
 */
function hookSetMatrix(node: THREE.Object3D, hook: Hook) {
  const elements = node.matrix.elements;
  let held: Float64Array | null = null;
  const freeze = () => {
    held = Float64Array.from(elements);
  };
  const compare = () => {
    if (!held) return;
    let moved = false;
    for (let k = 0; k < 16; k++)
      if (held[k] !== elements[k]) {
        held[k] = elements[k];
        moved = true;
      }
    if (moved) bump(hook);
  };
  if (!node.matrixAutoUpdate) freeze();
  accessor(node, 'matrixAutoUpdate', (auto) => {
    if (auto) held = null;
    else freeze();
    bump(hook);
  });
  let flag = node.matrixWorldNeedsUpdate;
  Object.defineProperty(node, 'matrixWorldNeedsUpdate', {
    configurable: true,
    enumerable: true,
    get: () => flag,
    set: (value: boolean) => {
      flag = value;
      compare();
    },
  });
}

/** Forgets `revision` on `node`: its writes no longer bump it. True when it was registered. */
export function unhookHostNode(node: THREE.Object3D, revision: WriteRevision) {
  const hook = hooks.get(node);
  const at = hook ? hook.revisions.indexOf(revision) : -1;
  if (!hook || at < 0) return false;
  hook.revisions.splice(at, 1);
  return true;
}
