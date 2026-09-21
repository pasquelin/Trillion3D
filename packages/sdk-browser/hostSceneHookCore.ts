/** What every host hook shares: the revision it bumps, and the hooked twin a node's vector becomes. */

/**
 * Revision a watch owns. Every write the host makes on the hooked pose of one of its nodes —
 * a position, a scale, a rotation — increments it at the instant of the write, so the frame
 * compares one integer instead of rereading those numbers.
 */
export interface WriteRevision {
  revision: number;
}

/** Hook of one host node: the revisions its writes bump. Empty once every watch has left. */
export interface Hook {
  revisions: WriteRevision[];
}

export function bump(hook: Hook) {
  const list = hook.revisions;
  for (let i = 0; i < list.length; i++) list[i].revision++;
}

const HOOK = Symbol('hook'),
  TWIN = Symbol('twin');
const XYZ = ['x', 'y', 'z'] as const;
type Key = (typeof XYZ)[number];
type Hooked = Record<string, number> & { [HOOK]: Hook };

/**
 * One prototype per plain one, shared by every hooked vector: the accessors live there, over
 * `_x`, `_y`, `_z` fields of the instance — the shape the reference gives its own quaternion.
 * No field of an existing object is ever redefined: V8 drops an object whose data field
 * becomes an accessor into dictionary mode for good, and the reference's matrix walk over
 * such nodes costs several times its price (measured in `bench/scene-hooks.perf.mjs`).
 */
const prototypes = new WeakMap<object, object>();
function hookedPrototype(plain: object) {
  let found = prototypes.get(plain);
  if (!found) {
    const accessors: PropertyDescriptorMap = {};
    for (const key of XYZ) {
      const slot = `_${key}`;
      accessors[key] = {
        get(this: Hooked) {
          return this[slot];
        },
        set(this: Hooked, value: number) {
          if (this[slot] === value) return;
          this[slot] = value;
          bump(this[HOOK]);
        },
      };
    }
    found = Object.create(plain, accessors) as object;
    prototypes.set(plain, found);
  }
  return found;
}

/** The fields of the vector the host may have kept, forwarded to its twin: one descriptor per
 *  key for every such vector, no closure per field. */
type Kept = Record<Key, number> & { [TWIN]: Hooked };
const forwarders = XYZ.map((key): PropertyDescriptor => ({
  configurable: true,
  enumerable: true,
  get(this: Kept) {
    return this[TWIN][key];
  },
  set(this: Kept, value: number) {
    this[TWIN][key] = value;
  },
}));

/**
 * Replaces `node[key]` — a vector the reference defines configurable and read-only — by a hooked
 * twin holding the same numbers: a write of another `x`, `y` or `z` bumps `hook`. The object
 * the host may have kept from before the hook forwards its reads and writes to the twin (an
 * animation bound to `mesh.position` keeps driving the node); it is off every hot path, so its
 * own fields may become accessors. Already hooked: the twin stays, with the hook it carries.
 */
export function hookVector<K extends string>(node: Record<K, object>, key: K, hook: Hook) {
  const kept = node[key] as Hooked & Kept;
  if (kept[HOOK]) return;
  const twin = Object.create(hookedPrototype(Object.getPrototypeOf(kept))) as Hooked;
  for (const field of XYZ) twin[`_${field}`] = kept[field];
  twin[HOOK] = hook;
  Object.defineProperty(node, key, { value: twin });
  kept[TWIN] = twin;
  for (let i = 0; i < XYZ.length; i++) Object.defineProperty(kept, XYZ[i], forwarders[i]);
}
