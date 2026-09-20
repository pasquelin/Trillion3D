/** What every host hook shares: the revisions it bumps, and the accessor a hooked field becomes. */

/**
 * Revisions a watch owns. Every write the host makes on one of the nodes hooked for it — a
 * pose, a visibility, a light's number — increments `revision` at the instant of the write, so
 * the frame compares one integer instead of rereading the graph. A write that changes WHICH
 * objects are read (a light retargeted, a node reparented) also increments `shape`: the watched
 * set is to be rebuilt, where a pose write leaves it as it stands.
 */
export interface WriteRevision {
  revision: number;
  shape: number;
}

/** Hook of one host node: the revisions it bumps, and how to take every accessor back. */
export interface Hook {
  revisions: WriteRevision[];
  undo: Array<() => void>;
}

export function bump(hook: Hook, shape = false) {
  const list = hook.revisions;
  for (let i = 0; i < list.length; i++) {
    list[i].revision++;
    if (shape) list[i].shape++;
  }
}

/** The plain data field a hooked one becomes again. */
const plain = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });

/**
 * Redefines a data field as an accessor of the instance: a write of ANOTHER value is announced
 * to `written` — every write when `always`, for a flag whose repeated raise means something.
 * The undo restores the field with the value it holds.
 */
export function accessor<T extends object, K extends keyof T & string>(
  target: T,
  key: K,
  hook: Hook,
  written: (value: T[K]) => void,
  always = false,
) {
  let held = target[key];
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => held,
    set: (value: T[K]) => {
      if (!always && value === held) return;
      held = value;
      written(value);
    },
  });
  hook.undo.push(() => plain(target, key, held));
}

/** Backing slots of a triple: its held numbers, and the hook its writes bump. */
const HELD = Symbol('held'),
  HOOK = Symbol('hook');
type Triple = { [HELD]?: Record<string, number>; [HOOK]?: Hook };

/** One descriptor per key, shared by every hooked instance: no closure per field, and every
 *  hooked vector of the host takes the same shape, so its hot sites stay monomorphic. */
const descriptors = new Map<string, PropertyDescriptor>();
function descriptor(key: string) {
  let found = descriptors.get(key);
  if (!found) {
    found = {
      configurable: true,
      enumerable: true,
      get(this: Triple) {
        return (this[HELD] as Record<string, number>)[key];
      },
      set(this: Triple, value: number) {
        const held = this[HELD] as Record<string, number>;
        if (held[key] === value) return;
        held[key] = value;
        bump(this[HOOK] as Hook);
      },
    };
    descriptors.set(key, found);
  }
  return found;
}

/**
 * `x`, `y`, `z` of a vector, or `r`, `g`, `b` of a colour, as accessors of the instance. The
 * reference gives a node its own vectors, so a triple belongs to one node; a triple already
 * hooked — a colour two lights share — keeps the hook it has.
 */
export function hookTriple(target: object, keys: readonly string[], hook: Hook) {
  const triple = target as Triple & Record<string, number>;
  if (triple[HOOK]) return;
  const held: Record<string, number> = {};
  for (const key of keys) held[key] = triple[key];
  triple[HELD] = held;
  triple[HOOK] = hook;
  for (const key of keys) Object.defineProperty(triple, key, descriptor(key));
  hook.undo.push(() => {
    for (const key of keys) plain(triple, key, held[key]);
    delete triple[HELD];
    delete triple[HOOK];
  });
}

export const XYZ = ['x', 'y', 'z'] as const,
  RGB = ['r', 'g', 'b'] as const;
