/** What every host hook shares: the revision it bumps, and the accessor a hooked field becomes. */

/**
 * Revision a watch owns. Every write the host makes on one of the nodes hooked for it — a pose,
 * a visibility, a light's number — increments `revision` at the instant of the write, so the
 * frame compares one integer instead of rereading the graph. A write that changes WHICH
 * objects are read (a light retargeted, a node reparented) increments it like any other: the
 * scene change it announces is what rebuilds the watched set.
 */
export interface WriteRevision {
  revision: number;
}

/** Hook of one host node: the revisions it bumps. A node hooked once stays hooked. */
export interface Hook {
  revisions: WriteRevision[];
}

/** A sub-object of a node — vector, quaternion, colour — bumps the hooks of its owners. */
export interface Owned {
  owners: Hook[];
}

const owned = new WeakMap<object, Owned>();

export function bump(hook: Hook) {
  const list = hook.revisions;
  for (let i = 0; i < list.length; i++) list[i].revision++;
}

/** Redefines a data field as an accessor of the instance: a write of ANOTHER value is announced. */
export function accessor<T extends object, K extends keyof T & string>(
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
export function owners(target: object, hook: Hook) {
  const known = owned.get(target);
  if (known) {
    if (!known.owners.includes(hook)) known.owners.push(hook);
    return null;
  }
  const fresh = { owners: [hook] };
  owned.set(target, fresh);
  return fresh;
}

export function bumpOwners(sub: Owned) {
  for (let i = 0; i < sub.owners.length; i++) bump(sub.owners[i]);
}

/** `x`, `y`, `z` of a vector, or `r`, `g`, `b` of a colour, as accessors of the instance. */
export function hookTriple<T extends object>(
  target: T,
  keys: readonly (keyof T & string)[],
  hook: Hook,
) {
  const sub = owners(target, hook);
  if (sub) for (const key of keys) accessor(target, key, () => bumpOwners(sub));
}

export const XYZ = ['x', 'y', 'z'] as const,
  RGB = ['r', 'g', 'b'] as const;
