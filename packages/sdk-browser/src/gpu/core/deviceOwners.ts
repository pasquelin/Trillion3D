import { sessionHandle, sharedGpuDevice } from './sessionHandle.ts';

/**
 * Who owns an error on a device that outlives its sessions.
 *
 * A world keeps one device and reopens its session on it. `uncapturederror` carries no owner, and
 * a closed session can still raise errors after it let go — work it submitted, a read it had
 * queued — at any time, in no order the standard fixes. What the standard does give is the label:
 * an implementation uses it "to identify the underlying internal object" in its error messages
 * (Chrome/Dawn writes `[Buffer "label"]`, `[Texture "label"]`, `[TextureView of Texture "label"]`).
 *
 * So each session claims the device and receives its own handle on it (`sessionHandle.ts`), which
 * joins the session's tag to every label it creates. The tag is the creating session's, whatever
 * other session is open by then: an object a closing session still creates keeps its tag. A view
 * of a texture the session did not create (the canvas's) takes its tag through `sessionLabel`.
 * What every session shares (`sharedGpuDevice`: the mip program, its uniforms) is created on the
 * device itself and carries none. One listener per device reads the tags an error names:
 * - an error that names a live claim's object goes to that claim;
 * - one that names only closed claims' objects is a closed claim's, out of memory or not;
 * - one that names none cannot be told apart and goes to every live claim, as before;
 * - an out-of-memory error that names no closed claim's object alone is the device's state:
 *   every live claim's (the named ones' when it names live claims), under `out-of-memory`.
 * Every error of a closed claim's is counted. One that names a closed claim not said yet is said
 * once, as a warning: on the console, and to the live claims' diagnostics when there are any,
 * with a frozen copy of the counts of the claims it names — one warning per error, however many
 * closed claims it names. The browser's own console line for an error of a closed claim's is
 * cancelled (`preventDefault`), since the warning carries its text and a red error would read as
 * the live session's failure. Every other error keeps the browser's line.
 *
 * `device.lost` is listened to once per device and reaches the claims still live; a claim made on
 * a device known lost is told at once, the first one a microtask later. A claim released leaves the registry: nothing retains a
 * closed session until the device dies. Nothing here runs per frame: only on an error, a claim
 * or a release.
 */
type GpuDeviceOwner = {
  /** An uncaptured error that is, or may be, this claim's: `uncaptured-error`, or `out-of-memory`
   *  for the device's own condition. */
  error(message: string, reason: GpuErrorReason): void;
  /** An error that names a closed claim not said yet; `counts`: the errors each claim it names
   *  raised so far, this one included, as a frozen copy. */
  closedError(message: string, counts: readonly ClosedErrorCount[]): void;
  /** The device is lost: every claim still live is. */
  lost(info: GpuDeviceLoss): void;
};
type GpuErrorReason = 'uncaptured-error' | 'out-of-memory';
type GpuDeviceLoss = { reason: string; message: string };
/** How many errors a closed claim raised: its tag, and its count. */
type ClosedErrorCount = { readonly session: string; readonly count: number };

/** What an owner holds: its handle on the device, and `release` once its session is closed,
 *  before its objects are destroyed. */
export type GpuDeviceClaim<D = GPUDevice> = {
  readonly tag: string;
  readonly device: D;
  release(): void;
};

type OwnedDevice = Pick<GPUDevice, 'lost'> & Partial<Pick<GPUDevice, 'addEventListener'>>;

const TAG = /@t3d:(\d+)/g;
/** One sequence for every device: a tag never names two claims. */
let lastId = 0;

const registries = new WeakMap<object, ReturnType<typeof ownerRegistry>>();

/** The device's own condition, not an object's: WebGPU raises it as `GPUOutOfMemoryError`. */
const outOfMemory = (error: unknown) =>
  typeof GPUOutOfMemoryError === 'function'
    ? error instanceof GPUOutOfMemoryError
    : (error as object | null)?.constructor?.name === 'GPUOutOfMemoryError';

function ownerRegistry(device: OwnedDevice) {
  const owners = new Map<number, GpuDeviceOwner>();
  /** Closed claims that raised an error, and how many. */
  const said = new Map<number, number>();
  device.addEventListener?.('uncapturederror', (event) => {
    const { error } = event;
    const message = String(error.message);
    const named = Array.from(message.matchAll(TAG), (match) => Number(match[1]));
    const live = named.filter((id) => owners.has(id));
    if (named.length > 0 && live.length === 0) {
      event.preventDefault();
      // A message may name one object twice (`[Buffer "x"] is destroyed. While calling [Buffer "x"]…`).
      const ids = [...new Set(named)];
      const fresh = ids.some((id) => !said.has(id));
      for (const id of ids) said.set(id, (said.get(id) ?? 0) + 1);
      if (!fresh) return;
      const counts = Object.freeze(
        ids.map((id) => Object.freeze({ session: `@t3d:${id}`, count: said.get(id)! })),
      );
      console.warn(`[trillion3d] WebGPU error of a closed session, not the live one's: ${message}`);
      for (const owner of owners.values()) owner.closedError(message, counts);
      return;
    }
    const reason = outOfMemory(error) ? 'out-of-memory' : 'uncaptured-error';
    for (const [id, owner] of owners)
      if (live.length === 0 || live.includes(id)) owner.error(message, reason);
  });
  let loss: GpuDeviceLoss | undefined;
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
      return {
        tag,
        device: sessionHandle(device, tag),
        release: () => {
          owners.delete(id);
        },
      };
    },
  };
}

/**
 * Claims `device` for one session: its errors and the device's loss reach `owner` until `release`,
 * and the session creates through `claim.device`. The first claim on a device installs its
 * listeners, and hears of a device already lost a microtask later, when `device.lost` settles; a
 * later claim on a device known lost marks `owner` lost before this returns.
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
