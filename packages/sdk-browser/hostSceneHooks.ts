import type * as THREE from 'three';

/**
 * Revision a watch owns. Every write the host makes on one of the nodes hooked for it — a pose,
 * a visibility, a light's number — increments `revision` at the instant of the write, so the
 * frame compares one integer instead of rereading the graph. `reshaped` says that a write
 * changed WHICH objects are read (a light retargeted, a node reparented): the watched set is
 * to be rebuilt, not only reread.
 */
export interface WriteRevision {
  revision: number;
  reshaped: boolean;
}

/** Hook of one host node: the revisions it bumps. A node hooked once stays hooked. */
interface Hook {
  revisions: WriteRevision[];
}

/** A sub-object of a node — vector, quaternion, colour — bumps the hooks of its owners. */
interface Owned {
  owners: Hook[];
}

const hooks = new WeakMap<object, Hook>();
const owned = new WeakMap<object, Owned>();

function bump(hook: Hook, reshape = false) {
  const list = hook.revisions;
  for (let i = 0; i < list.length; i++) {
    list[i].revision++;
    if (reshape) list[i].reshaped = true;
  }
}

/** Redefines a data field as an accessor of the instance: a write of ANOTHER value is announced. */
function accessor<T extends object, K extends keyof T & string>(
  target: T,
  key: K,
  written: (value: T[K]) => void,
) {
  let held = target[key];
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => held,
    set: (value: T[K]) => {
      if (value === held) return;
      held = value;
      written(value);
    },
  });
}

/** The owners of a sub-object, registering `hook` among them; `null` once it already was. */
function owners(target: object, hook: Hook) {
  const known = owned.get(target);
  if (known) {
    if (!known.owners.includes(hook)) known.owners.push(hook);
    return null;
  }
  const fresh = { owners: [hook] };
  owned.set(target, fresh);
  return fresh;
}

function bumpOwners(sub: Owned) {
  for (let i = 0; i < sub.owners.length; i++) bump(sub.owners[i]);
}

/** `x`, `y`, `z` of a vector, or `r`, `g`, `b` of a colour, as accessors of the instance. */
function hookTriple<T extends object>(target: T, keys: readonly (keyof T & string)[], hook: Hook) {
  const sub = owners(target, hook);
  if (sub) for (const key of keys) accessor(target, key, () => bumpOwners(sub));
}

const XYZ = ['x', 'y', 'z'] as const,
  RGB = ['r', 'g', 'b'] as const;

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

/** Numbers of a light the engines consume, when its type carries them. */
const LIGHT_NUMBERS = ['intensity', 'distance', 'decay', 'angle', 'penumbra'] as const;

type HookedLight = THREE.Light & {
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  groundColor?: THREE.Color;
  target?: THREE.Object3D;
};

function hookLight(light: HookedLight, hook: Hook) {
  for (const key of LIGHT_NUMBERS) if (key in light) accessor(light, key, () => bump(hook));
  // A colour replaced as a whole is hooked in turn: what the host writes into it afterwards
  // must still be seen.
  for (const key of ['color', 'groundColor'] as const) {
    const colour = light[key];
    if (!colour) continue;
    hookTriple(colour, RGB, hook);
    accessor(light, key, (next) => {
      if (next) hookTriple(next, RGB, hook);
      bump(hook);
    });
  }
  // A new target is another chain of ancestors to watch: the set is rebuilt.
  if ('target' in light) accessor(light, 'target', () => bump(hook, true));
}

/**
 * Hooks every write the contract lets the host make on `node`, once, and registers `revision`
 * among what those writes bump. Returns true when the registration is new.
 *
 * The local pose — position, rotation, scale — visibility, the recomposition flag and the
 * parent are accessors of the instance from then on: a write of another value costs the host
 * one comparison and one increment, and a frame that reads nothing else knows the node did
 * not move. A matrix set by hand, recomposition cut, is announced as the reference requires:
 * `matrixWorldNeedsUpdate = true` (which `updateMatrix()` writes itself). A reparented node
 * changes its ancestor chain: the watched set is rebuilt.
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
  accessor(node, 'matrixAutoUpdate', () => bump(hook));
  accessor(node, 'parent', () => bump(hook, true));
  let needsUpdate = node.matrixWorldNeedsUpdate;
  Object.defineProperty(node, 'matrixWorldNeedsUpdate', {
    configurable: true,
    enumerable: true,
    get: () => needsUpdate,
    set: (value: boolean) => {
      needsUpdate = value;
      // The reference recomposes an automatic node's matrix on its own walk and raises the
      // flag each time: only a node whose matrix the host sets announces something by it.
      if (value && !node.matrixAutoUpdate) bump(hook);
    },
  });
  if ((node as THREE.Light).isLight) hookLight(node as HookedLight, hook);
  return true;
}

/** Forgets `revision` on `node`: its writes no longer bump it. True when it was registered. */
export function unhookHostNode(node: THREE.Object3D, revision: WriteRevision) {
  const hook = hooks.get(node);
  const at = hook ? hook.revisions.indexOf(revision) : -1;
  if (!hook || at < 0) return false;
  hook.revisions.splice(at, 1);
  return true;
}
