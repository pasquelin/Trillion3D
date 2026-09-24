import { sessionHandle, sessionTag, tagsIn } from './sessionHandle.ts';

/**
 * Who owns an error on a device that outlives its sessions.
 *
 * A world keeps one device and reopens its session on it. Each session claims the device and
 * creates through its own handle (`sessionHandle.ts`), which `release` makes inert: from then on,
 * the closed session creates, writes and submits nothing, so it raises no new error.
 *
 * What it submitted before still runs, and `uncapturederror` carries no owner; the label does: an
 * implementation uses it "to identify the underlying internal object" in its messages (Dawn writes
 * `[Buffer "label"]`), and the handle joins the session's tag to every label. One listener per
 * device reads the tags an error names:
 * - an error that names a live claim's object goes to that claim;
 * - one that names only closed claims' objects is a warning on the console, and a
 *   `closedError` to the live claims — to the next claim when none is live (the last one kept);
 * - one that names none cannot be told apart and goes to every live claim.
 * Out of memory is reported as such (`GPUOutOfMemoryError`). `device.lost` is listened to once
 * per device and reaches the claims still live, or a later claim at once. Nothing here runs per
 * frame: only on an error, a claim or a release.
 */
type GpuDeviceOwner = {
  error(message: string, reason: 'uncaptured-error' | 'out-of-memory'): void;
  closedError(message: string): void;
  lost(info: GpuDeviceLoss): void;
};
type GpuDeviceLoss = { reason: string; message: string };

/** What an owner holds: its handle on the device, and `release` once its session is closed. */
export type GpuDeviceClaim = { readonly tag: string; readonly device: GPUDevice; release(): void };

type Registry = { owners: Map<number, GpuDeviceOwner>; loss?: GpuDeviceLoss; pending?: string };
const registries = new WeakMap<GPUDevice, Registry>();
/** One sequence for every device: a tag never names two claims. */
let lastId = 0;

const outOfMemory = (error: unknown) =>
  typeof GPUOutOfMemoryError === 'function'
    ? error instanceof GPUOutOfMemoryError
    : (error as object | null)?.constructor?.name === 'GPUOutOfMemoryError';

/** Claims `device` for one session: its errors and the device's loss reach `owner` until
 *  `release`, and the session creates through `claim.device`. A first claim on a device already
 *  lost hears of it when `device.lost` settles, a microtask later; a later one before this returns. */
export function claimGpuDevice(device: GPUDevice, owner: GpuDeviceOwner): GpuDeviceClaim {
  let registry = registries.get(device);
  if (!registry) {
    const entry: Registry = (registry = { owners: new Map() });
    registries.set(device, entry);
    device.addEventListener?.('uncapturederror', ({ error }) => {
      const message = String(error.message);
      const named = tagsIn(message);
      const live = named.filter((id) => entry.owners.has(id));
      if (named.length > 0 && live.length === 0) {
        console.warn(
          `[trillion3d] WebGPU error of a closed session, not the live one's: ${message}`,
        );
        if (entry.owners.size === 0) entry.pending = message;
        for (const owner of entry.owners.values()) owner.closedError(message);
        return;
      }
      const reason = outOfMemory(error) ? 'out-of-memory' : 'uncaptured-error';
      for (const [id, owner] of entry.owners)
        if (live.length === 0 || live.includes(id)) owner.error(message, reason);
    });
    const lost = (loss: GpuDeviceLoss) => {
      entry.loss = loss;
      for (const owner of entry.owners.values()) owner.lost(loss);
    };
    device.lost.then(
      (info) => lost({ reason: info.reason, message: info.message }),
      (error) => lost({ reason: 'unknown', message: String(error) }),
    );
  }
  const id = ++lastId,
    tag = sessionTag(id),
    handle = sessionHandle(device, tag),
    { owners } = registry;
  owners.set(id, owner);
  if (registry.loss) owner.lost(registry.loss);
  if (registry.pending !== undefined) owner.closedError(registry.pending);
  registry.pending = undefined;
  return {
    tag,
    device: handle.device,
    release() {
      owners.delete(id);
      handle.release();
    },
  };
}
