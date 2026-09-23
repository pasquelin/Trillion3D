/**
 * Who owns an error on a device that outlives its sessions.
 *
 * A world keeps one device and reopens its session on it. `uncapturederror` carries no owner, and
 * a closed session can still raise errors after it let go — work it submitted, a read it had
 * queued — at any time, in no order the standard fixes. What the standard does give is the label:
 * an implementation uses it "to identify the underlying internal object" in its error messages
 * (Chrome/Dawn writes `[Buffer "label"]`, `[Texture "label"]`, `[TextureView of Texture "label"]`).
 *
 * So each session claims the device, and every buffer, texture and query set created while it is
 * the newest claim carries its tag in its label. Those are the objects a session destroys when it
 * closes, the only ones whose later use is an error in itself. One listener per device reads the
 * tags an error names:
 * - an error that names a live claim's object goes to that claim;
 * - one that names only closed claims' objects is ignored, with a trace on the console;
 * - one that names none goes to every live claim, as before: it cannot be told apart.
 *
 * `device.lost` is listened to once per device and reaches the claims still live. A claim released
 * leaves the registry: nothing retains a closed session until the device dies. Cost: a label
 * joined at each creation; nothing per frame.
 */
type GpuDeviceOwner = {
  /** An uncaptured error that is, or may be, this claim's. */
  error(message: string): void;
  /** The device is lost: every claim still live is. */
  lost(info: { reason: string; message: string }): void;
};

/** What an owner holds: `release` once its session is closed, before its objects are destroyed. */
export type GpuDeviceClaim = { readonly tag: string; release(): void };

type OwnedDevice = Pick<GPUDevice, 'createBuffer' | 'createTexture' | 'lost'> &
  Partial<Pick<GPUDevice, 'createQuerySet' | 'addEventListener'>>;

const TAG = /@t3d:(\d+)/g;
const tagOf = (id: number) => `@t3d:${id}`;
/** One sequence for every device: a tag never names two claims. */
let lastId = 0;

const registries = new WeakMap<OwnedDevice, ReturnType<typeof ownerRegistry>>();

function ownerRegistry(device: OwnedDevice) {
  const owners = new Map<number, GpuDeviceOwner>();
  /** The tag new objects carry: the newest live claim's, none between sessions. */
  let creating = '';
  const tagged =
    <D extends { label?: string }, R>(create: (descriptor: D) => R) =>
    (descriptor: D) => {
      if (!creating) return create(descriptor);
      const { label } = descriptor;
      return create({ ...descriptor, label: label ? `${label} ${creating}` : creating });
    };
  device.createBuffer = tagged(device.createBuffer.bind(device));
  device.createTexture = tagged(device.createTexture.bind(device));
  if (device.createQuerySet) device.createQuerySet = tagged(device.createQuerySet.bind(device));
  device.addEventListener?.('uncapturederror', (event) => {
    const message = String(event.error.message);
    const named = Array.from(message.matchAll(TAG), (match) => Number(match[1]));
    const live = named.filter((id) => owners.has(id));
    if (named.length > 0 && live.length === 0) {
      console.debug(`[trillion3d] WebGPU error of a closed session, ignored: ${message}`);
      return;
    }
    for (const [id, owner] of owners)
      if (live.length === 0 || live.includes(id)) owner.error(message);
  });
  const lost = (info: { reason: string; message: string }) => {
    for (const owner of owners.values()) owner.lost(info);
  };
  device.lost.then(
    (info) => lost({ reason: info.reason, message: info.message }),
    (error) => lost({ reason: 'unknown', message: String(error) }),
  );
  return {
    claim(owner: GpuDeviceOwner): GpuDeviceClaim {
      const id = ++lastId;
      owners.set(id, owner);
      const tag = (creating = tagOf(id));
      return {
        tag,
        release() {
          owners.delete(id);
          if (creating !== tag) return;
          const newest = Array.from(owners.keys()).at(-1);
          creating = newest === undefined ? '' : tagOf(newest);
        },
      };
    },
  };
}

/**
 * Claims `device` for one session: its errors and the device's loss reach `owner` until `release`.
 * The first claim on a device installs its listeners and the labelling; call it before any other
 * wrapper of `createBuffer` (the allocation ledger), so that one keeps the labels as written.
 */
export function claimGpuDevice(device: OwnedDevice, owner: GpuDeviceOwner): GpuDeviceClaim {
  let registry = registries.get(device);
  if (!registry) registries.set(device, (registry = ownerRegistry(device)));
  return registry.claim(owner);
}

/** A label as the engine wrote it, without the session tag. */
export const untaggedLabel = (label: string | undefined) =>
  label?.replace(/ ?@t3d:\d+$/, '') || undefined;
