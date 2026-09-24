/**
 * A session's handle on a device the world keeps across sessions (`deviceOwners.ts` says why): a
 * proxy of the device whose `create*` methods — and the `createView` of the textures it creates —
 * join the session's tag to the label, so that an error naming an object names its session.
 *
 * Cost: one proxy per session; a member read goes through its `get` trap (~30 ns in Node), which
 * returns attributes as they are and a method bound once per key, bound again only if the device's
 * own member was replaced (the allocation ledger's). A tagged label is joined once per label the
 * engine writes, then read from a map; a descriptor is copied at a creation that has one, a
 * creation without one copies nothing. A frame reads a handful of members and creates one command
 * encoder, without descriptor: nothing allocated per frame.
 */
type Labelled = { label?: string } | undefined;
type Method = (...args: unknown[]) => unknown;

/** A session's labels: its tag, and each label the engine wrote as the session names it. */
type Session = {
  device: object;
  tag: string;
  untitled: { label: string };
  labels: Map<string, string>;
};

/** Each session's handle → the device it forwards to, and the session's labels. */
const handles = new WeakMap<object, Session>();
/** Each texture a handle created → its session. */
const textures = new WeakMap<object, Session>();
/** A texture's `createView` when it is the texture's own member (a test's stand-in); a WebGPU
 *  texture's is its prototype's, read from there. */
const ownViews = new WeakMap<object, Method>();

/** `label` as `session` names it: joined once, then read from its map. */
function tagged(session: Session, label: string) {
  let named = session.labels.get(label);
  if (named === undefined) session.labels.set(label, (named = `${label} ${session.tag}`));
  return named;
}

/** `descriptor` as `session` names it: a copy with the tagged label; the shared untitled one when
 *  there is no descriptor. */
function labelled(session: Session, descriptor: Labelled) {
  if (!descriptor) return session.untitled;
  return {
    ...descriptor,
    label: descriptor.label ? tagged(session, descriptor.label) : session.tag,
  };
}

/** The `createView` of every texture a handle created: one function, whatever the texture. */
function createTaggedView(this: GPUTexture, descriptor?: GPUTextureViewDescriptor): GPUTextureView {
  const create = ownViews.get(this) ?? (Object.getPrototypeOf(this) as GPUTexture).createView;
  return create.call(this, labelled(textures.get(this)!, descriptor)) as GPUTextureView;
}

function tagViews(session: Session, texture: GPUTexture) {
  if (!texture.createView) return texture;
  if (Object.hasOwn(texture, 'createView')) ownViews.set(texture, texture.createView as Method);
  textures.set(texture, session);
  texture.createView = createTaggedView;
  return texture;
}

/** A session's handle is read-only: a member is set on the device, for every session. */
function refuseWrite(): never {
  throw new TypeError('A session handle is read-only: set the member on the shared device');
}

/** The device behind a session's handle — the key and the creator of what every session shares;
 *  `device` itself when it is no handle. */
export function sharedGpuDevice<D extends object>(device: D): D {
  return (handles.get(device)?.device as D | undefined) ?? device;
}

/** `label` as the session behind `device` names its objects; `label` itself on the device. For an
 *  object the handle does not create — the canvas's texture views. */
export function sessionLabel(device: object, label: string) {
  const session = handles.get(device);
  return session ? tagged(session, label) : label;
}

/** A label as the engine wrote it, without the session tag. */
export const untaggedLabel = (label: string | undefined) =>
  label?.replace(/ ?@t3d:\d+$/, '') || undefined;

/**
 * `device` as one session sees it: a proxy whose reads go to the device at each access. An
 * attribute (`queue`, `limits`, `features`, `lost`, …) is returned as it is; a method is bound to
 * the device, so that the platform's check of `this` holds, once per key. The `create*` methods
 * join `tag` to the label they are given, and only they copy the descriptor.
 */
export function sessionHandle<D extends object>(device: D, tag: string): D {
  const session: Session = { device, tag, untitled: { label: tag }, labels: new Map() };
  const forward = (key: PropertyKey, method: Method): Method => {
    const bound = method.bind(device);
    if (typeof key !== 'string' || !key.startsWith('create')) return bound;
    return key === 'createTexture'
      ? (descriptor) =>
          tagViews(session, bound(labelled(session, descriptor as Labelled)) as GPUTexture)
      : (descriptor) => bound(labelled(session, descriptor as Labelled));
  };
  const methods = new Map<PropertyKey, { method: Method; bound: Method }>();
  const handle = new Proxy(device, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      let entry = methods.get(key);
      if (entry?.method !== value)
        methods.set(
          key,
          (entry = { method: value as Method, bound: forward(key, value as Method) }),
        );
      return entry.bound;
    },
    set: refuseWrite,
    defineProperty: refuseWrite,
    deleteProperty: refuseWrite,
  });
  handles.set(handle, session);
  return handle;
}
