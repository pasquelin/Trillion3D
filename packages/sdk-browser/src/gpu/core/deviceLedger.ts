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
  /** Bytes the limit still admits beside `bytes` (negative past it, none when it is not finite);
   *  unbounded without a limit. A caller with a smaller fallback asks no more than this, and its
   *  allocation is never refused. */
  readonly room: number;
  /** Terminal admission refusal: a session cannot present a fallback that omits the resource. Its
   *  message names the refused allocation by label, beside its bytes, the bytes held and the limit. */
  readonly refusal: Error | undefined;
  /** `check` admits each allocation this ledger counts, by bytes; the label names it in a refusal,
   *  and `tentative` says the allocation is made under `tentative`: a refusal of it is no session's. */
  observeAdmission(check: Admission): () => void;
  releaseAdmission(): void;
  /** Runs `build` — synchronous — for a caller with a smaller fallback: an allocation past the
   *  limit throws as ever, but the session is not refused for it (`refusal` stays as it was). */
  tentative<T>(build: () => T): T;
  transaction(): { commit(): void; rollback(): void };
}

/** A session budget's check of one allocation (`GpuDeviceLedger.observeAdmission`). */
type Admission = (bytes: number, label: string, tentative: boolean) => void;

/** Device subset the ledger observes: what a fake test device provides. */
type LedgerDevice = Pick<GPUDevice, 'createTexture' | 'createBuffer'>;

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
  let refusal: Error | undefined,
    tentative = 0;
  const admissions = new Set<Admission>();
  const transactions = new Set<Set<{ destroy(): void }>>();
  // The label is the descriptor's, as the engine wrote it: a shared allocation carries its own
  // label to every session budget it crosses, and so does a tentative one its tentativeness — made
  // under this ledger's `tentative`, or under its base's — so no budget it crosses is refused.
  const check = (bytes: number, label: string, held = false) => {
    const soft = held || tentative > 0;
    const total = liveBytes + (base?.bytes ?? 0) + bytes;
    const ceiling = limit?.();
    if (ceiling !== undefined && (!Number.isFinite(ceiling) || total > ceiling)) {
      const error = new Error(
        `GPU_BUDGET_EXCEEDED: requested=${bytes}, label=${label}, held=${total - bytes}, limit=${ceiling}`,
      );
      if (!soft) refusal = error;
      throw error;
    }
    try {
      for (const admission of admissions) admission(bytes, label, soft);
    } catch (error) {
      if (!soft) refusal = error as Error;
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
    const label = descriptor.label ?? LABEL_NONE;
    if (bytes === null && (limit || admissions.size)) {
      // Notify active session budgets too; no unknown shared allocation can bypass them.
      check(Infinity, label);
      refusal = new Error('GPU_BUDGET_UNKNOWN_FORMAT');
      throw refusal;
    }
    check(bytes ?? 0, label);
    if (bytes === null) unknownFormats++;
    return track(createTexture(descriptor), label, bytes ?? 0);
  };
  device.createBuffer = (descriptor) => {
    if (counts && !counts(descriptor.label)) return createBuffer(descriptor);
    const label = descriptor.label ?? LABEL_NONE;
    check(descriptor.size, label);
    return track(createBuffer(descriptor), label, descriptor.size);
  };
  const ledger: GpuDeviceLedger = {
    get bytes() {
      return liveBytes + (base?.bytes ?? 0);
    },
    get room() {
      const ceiling = limit?.();
      if (ceiling === undefined) return Infinity;
      return Number.isFinite(ceiling) ? ceiling - ledger.bytes : 0;
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
    tentative(build) {
      tentative++;
      try {
        // The base's own admissions, other sessions' limits, are tentative too: the base hands its
        // tentativeness to every budget it checks a shared allocation against (`check`).
        return base ? base.tentative(build) : build();
      } finally {
        tentative--;
      }
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

/** Bytes the device's ledger still admits (`GpuDeviceLedger.room`): unbounded without a ledger. */
export const ledgerRoom = (device: LedgerDevice | undefined) =>
  gpuDeviceLedgerOf(device)?.room ?? Infinity;

/** `build` run tentatively on the device's ledger (`GpuDeviceLedger.tentative`), or as is without
 *  one. */
export const ledgerTentative = <T>(device: LedgerDevice | undefined, build: () => T): T => {
  const ledger = gpuDeviceLedgerOf(device);
  return ledger ? ledger.tentative(build) : build();
};
