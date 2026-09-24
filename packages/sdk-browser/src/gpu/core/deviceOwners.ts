/**
 * Who owns an error on a device that outlives its sessions.
 *
 * A world keeps one device and reopens its session on it. `uncapturederror` carries no owner, and
 * a closed session can still raise errors after it let go — work it submitted, a read it had
 * queued — at any time, in no order the standard fixes. What the standard does give is the label:
 * an implementation uses it "to identify the underlying internal object" in its error messages
 * (Chrome/Dawn writes `[Buffer "label"]`, `[Texture "label"]`, `[TextureView of Texture "label"]`).
 *
 * So each session claims the device and receives its own handle on it: an object that forwards
 * everything to the device, whose `create*` methods — and the `createView` of the textures it
 * creates — join the session's tag to the label. The tag is the creating session's, whatever
 * other session is open by then: an object a closing session still creates keeps its tag. What
 * every session shares (`sharedGpuDevice`: the mip program, its uniforms) is created on the device
 * itself and carries none. One listener per device reads the tags an error names:
 * - an error that names a live claim's object goes to that claim;
 * - one that names only closed claims' objects is said as a warning, once per closed claim to the
 *   live claims' diagnostics (on the console alone while none is live), never as a loss;
 * - one that names none goes to every live claim, as before: it cannot be told apart.
 *
 * `device.lost` is listened to once per device and reaches the claims still live; a claim made on
 * a device already lost is told at once. A claim released leaves the registry: nothing retains a
 * closed session until the device dies. Cost: the handle is built once per session, its methods
 * bound then; a label joined at each creation; nothing else per frame.
 */
type GpuDeviceOwner = {
  /** An uncaptured error that is, or may be, this claim's. */
  error(message: string): void;
  /** An error that names only a closed claim's objects: said once per closed claim. */
  closedError(message: string): void;
  /** The device is lost: every claim still live is. */
  lost(info: GpuDeviceLoss): void;
};
type GpuDeviceLoss = { reason: string; message: string };

/** What an owner holds: its handle on the device, and `release` once its session is closed,
 *  before its objects are destroyed. */
export type GpuDeviceClaim<D = GPUDevice> = {
  readonly tag: string;
  readonly device: D;
  release(): void;
};

type OwnedDevice = Pick<GPUDevice, 'lost'> & Partial<Pick<GPUDevice, 'addEventListener'>>;
type Labelled = { label?: string } | undefined;

const TAG = /@t3d:(\d+)/g;
/** One sequence for every device: a tag never names two claims. */
let lastId = 0;

const registries = new WeakMap<object, ReturnType<typeof ownerRegistry>>();
/** Each session's handle → the device it forwards to. */
const devices = new WeakMap<object, object>();

/** The device behind a session's handle — the key and the creator of what every session shares;
 *  `device` itself when it is no handle. */
export function sharedGpuDevice<D extends object>(device: D): D {
  return (devices.get(device) as D | undefined) ?? device;
}

/** A label as the engine wrote it, without the session tag. */
export const untaggedLabel = (label: string | undefined) =>
  label?.replace(/ ?@t3d:\d+$/, '') || undefined;

/**
 * `device` as one session sees it. Every member of the device and of its prototypes is forwarded:
 * methods bound to the device once, here, so that the platform's check of `this` holds; attributes
 * (`queue`, `limits`, `features`, `lost`, `label`, `onuncapturederror`) read and written on the
 * device at each access. The `create*` methods join `tag` to the label they are given.
 */
function sessionHandle<D extends object>(device: D, tag: string): D {
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
  const target = device as unknown as Record<PropertyKey, unknown>;
  const handle: Record<PropertyKey, unknown> = {};
  for (let from: object | null = device; from && from !== Object.prototype;) {
    for (const key of Reflect.ownKeys(from)) {
      if (key === 'constructor' || Object.hasOwn(handle, key)) continue;
      const { value } = Object.getOwnPropertyDescriptor(from, key)!;
      if (typeof value !== 'function')
        Object.defineProperty(handle, key, {
          get: () => target[key],
          set: (next: unknown) => (target[key] = next),
          enumerable: true,
        });
      else if (typeof key !== 'string' || !key.startsWith('create'))
        handle[key] = value.bind(device);
      else {
        const create = value.bind(device) as (descriptor: Labelled) => unknown;
        handle[key] =
          key === 'createTexture'
            ? (descriptor: Labelled) => tagViews(create(labelled(descriptor)) as GPUTexture)
            : (descriptor: Labelled) => create(labelled(descriptor));
      }
    }
    from = Object.getPrototypeOf(from) as object | null;
  }
  devices.set(handle, device);
  return handle as D;
}

function ownerRegistry(device: OwnedDevice) {
  const owners = new Map<number, GpuDeviceOwner>();
  /** Closed claims whose error was already said. */
  const said = new Set<number>();
  let loss: GpuDeviceLoss | undefined;
  device.addEventListener?.('uncapturederror', (event) => {
    const message = String(event.error.message);
    const named = Array.from(message.matchAll(TAG), (match) => Number(match[1]));
    const live = named.filter((id) => owners.has(id));
    if (named.length > 0 && live.length === 0) {
      const fresh = named.filter((id) => !said.has(id));
      if (fresh.length === 0) return;
      console.warn(`[trillion3d] WebGPU error of a closed session, not the live one's: ${message}`);
      // Between two sessions no diagnostics hear it: the next error of the same is said to them.
      if (owners.size === 0) return;
      for (const id of fresh) said.add(id);
      for (const owner of owners.values()) owner.closedError(message);
      return;
    }
    for (const [id, owner] of owners)
      if (live.length === 0 || live.includes(id)) owner.error(message);
  });
  const lost = (info: GpuDeviceLoss) => {
    loss = info;
    for (const owner of owners.values()) owner.lost(info);
  };
  device.lost.then(
    (info) => lost({ reason: info.reason, message: info.message }),
    (error) => lost({ reason: 'unknown', message: String(error) }),
  );
  return {
    claim(owner: GpuDeviceOwner): GpuDeviceClaim<OwnedDevice> {
      const id = ++lastId,
        tag = `@t3d:${id}`;
      owners.set(id, owner);
      if (loss) owner.lost(loss);
      return { tag, device: sessionHandle(device, tag), release: () => owners.delete(id) };
    },
  };
}

/**
 * Claims `device` for one session: its errors and the device's loss reach `owner` until `release`,
 * and the session creates through `claim.device`. The first claim on a device installs its
 * listeners; a device already lost marks `owner` lost before this returns.
 */
export function claimGpuDevice<D extends OwnedDevice>(
  device: D,
  owner: GpuDeviceOwner,
): GpuDeviceClaim<D> {
  const shared = sharedGpuDevice(device);
  let registry = registries.get(shared);
  if (!registry) registries.set(shared, (registry = ownerRegistry(shared)));
  return registry.claim(owner) as GpuDeviceClaim<D>;
}
