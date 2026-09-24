/**
 * A session's handle on a device the world keeps across sessions (`deviceOwners.ts` says why): a
 * proxy of the device whose `create*` methods — and the `createView` of the textures it creates —
 * join the session's tag to the label, so that an error naming an object names its session.
 *
 * Cost: one proxy per session; a member read goes through its `get` trap (~30 ns in Node), which
 * returns attributes as they are and a method bound once per key, bound again only if the device's
 * own member was replaced (the allocation ledger's). A label is joined, and a descriptor copied, at
 * each creation only; a creation without a descriptor copies nothing. A frame reads a handful of
 * members and creates one command encoder, without descriptor: nothing allocated per frame.
 */
type Labelled = { label?: string } | undefined;
type Method = (...args: unknown[]) => unknown;

/** Each session's handle → the device it forwards to, and the session's tag. */
const handles = new WeakMap<object, { device: object; tag: string }>();

/** The device behind a session's handle — the key and the creator of what every session shares;
 *  `device` itself when it is no handle. */
export function sharedGpuDevice<D extends object>(device: D): D {
  return (handles.get(device)?.device as D | undefined) ?? device;
}

/** `label` as the session behind `device` names its objects; `label` itself on the device. For an
 *  object the handle does not create — the canvas's texture views. */
export function sessionLabel(device: object, label: string) {
  const tag = handles.get(device)?.tag;
  return tag ? `${label} ${tag}` : label;
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
  const untitled = { label: tag };
  const labelled = (descriptor: Labelled) =>
    descriptor
      ? { ...descriptor, label: descriptor.label ? `${descriptor.label} ${tag}` : tag }
      : untitled;
  const tagViews = (texture: GPUTexture) => {
    const createView = texture.createView?.bind(texture);
    if (createView)
      texture.createView = (descriptor?: GPUTextureViewDescriptor) =>
        createView(labelled(descriptor));
    return texture;
  };
  const forward = (key: PropertyKey, method: Method): Method => {
    const bound = method.bind(device);
    if (typeof key !== 'string' || !key.startsWith('create')) return bound;
    return key === 'createTexture'
      ? (descriptor) => tagViews(bound(labelled(descriptor as Labelled)) as GPUTexture)
      : (descriptor) => bound(labelled(descriptor as Labelled));
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
    set: (target, key, value) => Reflect.set(target, key, value, target),
  });
  handles.set(handle, { device, tag });
  return handle;
}
