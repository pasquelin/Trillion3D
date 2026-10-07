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
import {
  checkAllocation,
  ledgerSnapshot,
  ledgerTransaction,
  observeCreates,
  type Admission,
  type GpuDeviceLedgerSnapshot,
  type LedgerBooks,
  type LedgerDevice,
} from './ledgerBooks.ts'

export interface GpuDeviceLedger {
  snapshot(): GpuDeviceLedgerSnapshot
  readonly bytes: number
  /** Bytes the limit still admits beside `bytes` (negative past it, none when it is not finite);
   *  unbounded without a limit. A caller with a smaller fallback asks no more than this, and its
   *  allocation is never refused. */
  readonly room: number
  /** Terminal admission refusal: a session cannot present a fallback that omits the resource. Its
   *  message names the refused allocation by label, beside its bytes, the bytes held and the limit. */
  readonly refusal: Error | undefined
  /** `check` admits each allocation this ledger counts, by bytes; the label names it in a refusal,
   *  and `tentative` says the allocation is made under `tentative`: a refusal of it is no session's. */
  observeAdmission(check: Admission): () => void
  releaseAdmission(): void
  /** Runs `build` — synchronous — for a caller with a smaller fallback: an allocation past the
   *  limit throws as ever, but the session is not refused for it (`refusal` stays as it was). */
  tentative<T>(build: () => T): T
  transaction(): { commit(): void; rollback(): void }
}

const ledgers = new WeakMap<LedgerDevice, GpuDeviceLedger>()

/** Installs the ledger on the device — a session's handle, above its tags: it counts by the labels
 *  the engine wrote — or returns the one already there. `counts` keeps the allocations it counts
 *  (all by default); `base`, another ledger, is carried in each snapshot. */
export function installGpuDeviceLedger(
  device: LedgerDevice,
  options: {
    counts?: (label: string | undefined) => boolean
    base?: GpuDeviceLedger
    limit?: () => number
  } = {},
): GpuDeviceLedger {
  const existing = ledgers.get(device)
  if (existing) return existing
  const { base, limit } = options
  const books: LedgerBooks = {
    ...options,
    live: new Map(),
    unknownFormats: 0,
    liveBytes: 0,
    refusal: undefined,
    tentative: 0,
    admissions: new Set(),
    transactions: new Set(),
    held: undefined,
    heldBase: undefined,
  }
  const check = (bytes: number, label: string, held = false) =>
    checkAllocation(books, bytes, label, held)
  const unobserve = limit ? base?.observeAdmission(check) : undefined
  observeCreates(device, books)
  const ledger = ledgerOver(books, base, unobserve)
  ledgers.set(device, ledger)
  return ledger
}

/** The ledger's face over `books`, `base` its base and `unobserve` its release from it. */
function ledgerOver(
  books: LedgerBooks,
  base: GpuDeviceLedger | undefined,
  unobserve: (() => void) | undefined,
): GpuDeviceLedger {
  const { limit, admissions } = books
  const ledger: GpuDeviceLedger = {
    get bytes() {
      return books.liveBytes + (base?.bytes ?? 0)
    },
    get room() {
      const ceiling = limit?.()
      if (ceiling === undefined) return Infinity
      return Number.isFinite(ceiling) ? ceiling - ledger.bytes : 0
    },
    get refusal() {
      return books.refusal ?? base?.refusal
    },
    observeAdmission(admission) {
      admissions.add(admission)
      return () => {
        admissions.delete(admission)
        if (!admissions.size && !limit) books.refusal = undefined
      }
    },
    releaseAdmission() {
      unobserve?.()
    },
    tentative(build) {
      books.tentative++
      try {
        // The base's own admissions, other sessions' limits, are tentative too: the base hands its
        // tentativeness to every budget it checks a shared allocation against (`check`).
        return base ? base.tentative(build) : build()
      } finally {
        books.tentative--
      }
    },
    transaction: () => ledgerTransaction(books),
    snapshot: () => ledgerSnapshot(books),
  }
  return ledger
}

/** A device's ledger, or `undefined` until one is installed on it. */
export const gpuDeviceLedgerOf = (device: LedgerDevice | undefined) =>
  device ? ledgers.get(device) : undefined

/** Bytes the device's ledger still admits (`GpuDeviceLedger.room`): unbounded without a ledger. */
export const ledgerRoom = (device: LedgerDevice | undefined) =>
  gpuDeviceLedgerOf(device)?.room ?? Infinity

/** `build` run tentatively on the device's ledger (`GpuDeviceLedger.tentative`), or as is without
 *  one. */
export const ledgerTentative = <T>(device: LedgerDevice | undefined, build: () => T): T => {
  const ledger = gpuDeviceLedgerOf(device)
  return ledger ? ledger.tentative(build) : build()
}
