/**
 * Allocation ledger of a WebGPU device: every texture and buffer created, their bytes computed
 * from the descriptor, returned on destroy. WebGPU does not publish occupied memory; this ledger
 * is the only sum that depends on no subsystem, and a buffer never destroyed stays counted
 * here — that is intended, a leak is read here before it is read elsewhere.
 *
 * It is installed once per device, on the instance, before the engine's first allocation; a
 * second call returns the same ledger. A session's ledger sits on its handle; the shared device's
 * counts only what names no session — the caches every session shares — and the session's
 * snapshot carries it, so that each allocation is counted once. A texture of a format unknown to the table counts zero
 * bytes and increments `unknownFormats`: a total that carries any is not a proof.
 */
const LABEL_NONE = 'unlabeled';

import { textureBytesOf } from './textureBytes.ts';

interface GpuDeviceLedgerSnapshot {
  /** Live bytes, every allocation included. */
  bytes: number;
  /** The same bytes by label, heaviest first. */
  byLabel: Record<string, number>;
  /** Textures of a format outside the table, counted as zero bytes. */
  unknownFormats: number;
  /** Live allocations. */
  live: number;
}
export interface GpuDeviceLedger {
  snapshot(): GpuDeviceLedgerSnapshot;
  readonly bytes: number;
  /** Terminal admission refusal: a session cannot present a fallback that omits the resource. */
  readonly refusal: Error | undefined;
  observeAdmission(check: (bytes: number) => void): () => void;
  releaseAdmission(): void;
  transaction(): { commit(): void; rollback(): void };
}

/** Device subset the ledger observes: what a fake test device provides. */
export type LedgerDevice = Pick<GPUDevice, 'createTexture' | 'createBuffer'>;

const ledgers = new WeakMap<LedgerDevice, GpuDeviceLedger>();

/** Installs the ledger on the device — a session's handle, above its tags: it counts by the labels
 *  the engine wrote — or returns the one already there. `counts` keeps the allocations it counts
 *  (all by default); `base`, another ledger, is carried in each snapshot. */
export function installGpuDeviceLedger(
  device: LedgerDevice,
  options: {
    counts?: (label: string | undefined) => boolean;
    base?: GpuDeviceLedger;
    limit?: () => number;
  } = {},
): GpuDeviceLedger {
  const existing = ledgers.get(device);
  if (existing) return existing;
  const { counts, base, limit } = options;
  const live = new Map<object, { label: string; bytes: number }>();
  let unknownFormats = 0,
    liveBytes = 0;
  let refusal: Error | undefined;
  const admissions = new Set<(bytes: number) => void>();
  const transactions = new Set<Set<{ destroy(): void }>>();
  const check = (bytes: number) => {
    const total = liveBytes + (base?.bytes ?? 0) + bytes;
    const ceiling = limit?.();
    if (ceiling !== undefined && (!Number.isFinite(ceiling) || total > ceiling)) {
      refusal = new Error(
        `GPU_BUDGET_EXCEEDED: requested=${bytes}, held=${total - bytes}, limit=${ceiling}`,
      );
      throw refusal;
    }
    try {
      for (const admission of admissions) admission(bytes);
    } catch (error) {
      refusal = error as Error;
      throw error;
    }
  };
  const unobserve = limit ? base?.observeAdmission(check) : undefined;
  // The snapshot is read every host frame, held frame included: it is rebuilt only after an
  // allocation or a destroy, its own or its base's, never in a still scene.
  let held: GpuDeviceLedgerSnapshot | undefined, heldBase: GpuDeviceLedgerSnapshot | undefined;
  const track = <T extends { destroy(): void }>(resource: T, label: string, bytes: number) => {
    live.set(resource, { label, bytes });
    liveBytes += bytes;
    for (const transaction of transactions) transaction.add(resource);
    held = undefined;
    const destroy = resource.destroy;
    resource.destroy = function (this: T) {
      if (live.delete(resource)) {
        liveBytes -= bytes;
        held = undefined;
      }
      return destroy.call(this);
    };
    return resource;
  };
  const createTexture = device.createTexture.bind(device);
  const createBuffer = device.createBuffer.bind(device);
  device.createTexture = (descriptor) => {
    if (counts && !counts(descriptor.label)) return createTexture(descriptor);
    const bytes = textureBytesOf(descriptor);
    if (bytes === null && (limit || admissions.size)) {
      // Notify active session budgets too; no unknown shared allocation can bypass them.
      check(Infinity);
      refusal = new Error('GPU_BUDGET_UNKNOWN_FORMAT');
      throw refusal;
    }
    check(bytes ?? 0);
    if (bytes === null) unknownFormats++;
    return track(createTexture(descriptor), descriptor.label ?? LABEL_NONE, bytes ?? 0);
  };
  device.createBuffer = (descriptor) => {
    if (counts && !counts(descriptor.label)) return createBuffer(descriptor);
    check(descriptor.size);
    return track(createBuffer(descriptor), descriptor.label ?? LABEL_NONE, descriptor.size);
  };
  const ledger: GpuDeviceLedger = {
    get bytes() {
      return liveBytes + (base?.bytes ?? 0);
    },
    get refusal() {
      return refusal ?? base?.refusal;
    },
    observeAdmission(admission) {
      admissions.add(admission);
      return () => {
        admissions.delete(admission);
        if (!admissions.size && !limit) refusal = undefined;
      };
    },
    releaseAdmission() {
      unobserve?.();
    },
    transaction() {
      const resources = new Set<{ destroy(): void }>();
      let active = true;
      transactions.add(resources);
      return {
        commit() {
          active = false;
          transactions.delete(resources);
        },
        rollback() {
          if (!active) return;
          active = false;
          transactions.delete(resources);
          for (const resource of resources) if (live.has(resource)) resource.destroy();
        },
      };
    },
    snapshot() {
      const under = base?.snapshot();
      if (held && heldBase === under) return held;
      heldBase = under;
      const sums = new Map<string, number>(under ? Object.entries(under.byLabel) : []);
      let bytes = under?.bytes ?? 0;
      for (const entry of live.values()) {
        bytes += entry.bytes;
        sums.set(entry.label, (sums.get(entry.label) ?? 0) + entry.bytes);
      }
      const byLabel = Object.fromEntries([...sums].sort((a, b) => b[1] - a[1]));
      return (held = {
        bytes,
        byLabel,
        unknownFormats: unknownFormats + (under?.unknownFormats ?? 0),
        live: live.size + (under?.live ?? 0),
      });
    },
  };
  ledgers.set(device, ledger);
  return ledger;
}

/** A device's ledger, or `undefined` until one is installed on it. */
export const gpuDeviceLedgerOf = (device: LedgerDevice | undefined) =>
  device ? ledgers.get(device) : undefined;
