import { textureBytesOf } from './textureBytes.ts'

const LABEL_NONE = 'unlabeled'

/** One snapshot of a ledger (`GpuDeviceLedger.snapshot`). */
export interface GpuDeviceLedgerSnapshot {
  /** Live bytes, every allocation included. */
  bytes: number
  /** The same bytes by label, heaviest first. */
  byLabel: Record<string, number>
  /** Textures of a format outside the table, counted as zero bytes. */
  unknownFormats: number
  /** Live allocations. */
  live: number
}

/** A session budget's check of one allocation (`GpuDeviceLedger.observeAdmission`). */
export type Admission = (bytes: number, label: string, tentative: boolean) => void

/** Device subset the ledger observes: what a fake test device provides. */
export type LedgerDevice = Pick<GPUDevice, 'createTexture' | 'createBuffer'>

/** What a ledger keeps (`deviceLedger.ts`): its options, the live allocations and their sums, the
 *  terminal refusal, the budgets and transactions observing it, the snapshot held. */
export type LedgerBooks = {
  counts?: (label: string | undefined) => boolean
  base?: { readonly bytes: number; snapshot(): GpuDeviceLedgerSnapshot }
  limit?: () => number
  live: Map<object, { label: string; bytes: number }>
  unknownFormats: number
  liveBytes: number
  refusal: Error | undefined
  tentative: number
  admissions: Set<Admission>
  transactions: Set<Set<{ destroy(): void }>>
  /** The snapshot is read every host frame, held frame included: it is rebuilt only after an
   *  allocation or a destroy, its own or its base's, never in a still scene. */
  held: GpuDeviceLedgerSnapshot | undefined
  heldBase: GpuDeviceLedgerSnapshot | undefined
}

/** Admits `bytes` under `label` against the limit and the observing budgets, or throws. The label
 *  is the descriptor's, as the engine wrote it: a shared allocation carries its own label to every
 *  session budget it crosses, and so does a tentative one its tentativeness — made under this
 *  ledger's `tentative`, or under its base's — so no budget it crosses is refused. */
export function checkAllocation(books: LedgerBooks, bytes: number, label: string, held = false) {
  const soft = held || books.tentative > 0
  const total = books.liveBytes + (books.base?.bytes ?? 0) + bytes
  const ceiling = books.limit?.()
  if (ceiling !== undefined && (!Number.isFinite(ceiling) || total > ceiling)) {
    const error = new Error(
      `GPU_BUDGET_EXCEEDED: requested=${bytes}, label=${label}, held=${total - bytes}, limit=${ceiling}`,
    )
    if (!soft) books.refusal = error
    throw error
  }
  try {
    for (const admission of books.admissions) admission(bytes, label, soft)
  } catch (error) {
    if (!soft) books.refusal = error as Error
    throw error
  }
}

/** Counts `resource` until its `destroy`, in every transaction open. */
function track<T extends { destroy(): void }>(
  books: LedgerBooks,
  resource: T,
  label: string,
  bytes: number,
) {
  books.live.set(resource, { label, bytes })
  books.liveBytes += bytes
  for (const transaction of books.transactions) transaction.add(resource)
  books.held = undefined
  const destroy = resource.destroy
  resource.destroy = function (this: T) {
    if (books.live.delete(resource)) {
      books.liveBytes -= bytes
      books.held = undefined
    }
    return destroy.call(this)
  }
  return resource
}

/** The device's `createTexture` and `createBuffer`, made to admit and count what they make. */
export function observeCreates(device: LedgerDevice, books: LedgerBooks) {
  const { counts, limit } = books
  const createTexture = device.createTexture.bind(device)
  const createBuffer = device.createBuffer.bind(device)
  device.createTexture = (descriptor) => {
    if (counts && !counts(descriptor.label)) return createTexture(descriptor)
    const bytes = textureBytesOf(descriptor)
    const label = descriptor.label ?? LABEL_NONE
    if (bytes === null && (limit || books.admissions.size)) {
      // Notify active session budgets too; no unknown shared allocation can bypass them.
      checkAllocation(books, Infinity, label)
      books.refusal = new Error('GPU_BUDGET_UNKNOWN_FORMAT')
      throw books.refusal
    }
    checkAllocation(books, bytes ?? 0, label)
    if (bytes === null) books.unknownFormats++
    return track(books, createTexture(descriptor), label, bytes ?? 0)
  }
  device.createBuffer = (descriptor) => {
    if (counts && !counts(descriptor.label)) return createBuffer(descriptor)
    const label = descriptor.label ?? LABEL_NONE
    checkAllocation(books, descriptor.size, label)
    return track(books, createBuffer(descriptor), label, descriptor.size)
  }
}

/** The allocations made from now on, destroyed together by `rollback` unless `commit` keeps them. */
export function ledgerTransaction(books: LedgerBooks) {
  const resources = new Set<{ destroy(): void }>()
  let active = true
  books.transactions.add(resources)
  return {
    commit() {
      active = false
      books.transactions.delete(resources)
    },
    rollback() {
      if (!active) return
      active = false
      books.transactions.delete(resources)
      for (const resource of resources) if (books.live.has(resource)) resource.destroy()
    },
  }
}

/** The ledger's sums with its base's, rebuilt only when either moved. */
export function ledgerSnapshot(books: LedgerBooks): GpuDeviceLedgerSnapshot {
  const under = books.base?.snapshot()
  if (books.held && books.heldBase === under) return books.held
  books.heldBase = under
  const sums = new Map<string, number>(under ? Object.entries(under.byLabel) : [])
  let bytes = under?.bytes ?? 0
  for (const entry of books.live.values()) {
    bytes += entry.bytes
    sums.set(entry.label, (sums.get(entry.label) ?? 0) + entry.bytes)
  }
  const byLabel = Object.fromEntries([...sums].sort((a, b) => b[1] - a[1]))
  return (books.held = {
    bytes,
    byLabel,
    unknownFormats: books.unknownFormats + (under?.unknownFormats ?? 0),
    live: books.live.size + (under?.live ?? 0),
  })
}
