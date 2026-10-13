import { ledgerTentative } from '../core/deviceLedger.ts'

/** The session's budget asked for a buffer of `bytes` more of the cut's tables: it throws, by its
 *  own name, when it cannot fund them. */
export type CutAdmission = (bytes: number) => void

/** Every buffer of a cut's tables starts so: what the budget counts as their share
 *  (`cutLedgerBytes`). */
const CUT_LABEL = 'Trillion3D DAG'

/** The refusal of a cut whose tables would hold `bytes`, past its `share`: said by name. */
const pastShare = (bytes: number, share: number) =>
  new Error(`GPU_CUT_TABLES_PAST_SHARE: ${bytes} > ${share}`)

/**
 * The one way a buffer of a cut's tables is made, beside the `held` bytes they hold: within the
 * `share`, the session's budget asked first (`admit`), and made tentatively on its ledger — a
 * refusal never refuses the session: the cut keeps the tables it holds (`listCap.ts`)
 * (`ledgerTentative`).
 */
export function madeAsked(
  device: GPUDevice,
  admit: CutAdmission,
  held: number,
  share: number,
  descriptor: GPUBufferDescriptor,
) {
  if (held + descriptor.size > share) throw pastShare(held + descriptor.size, share)
  if (!descriptor.label?.startsWith(CUT_LABEL)) throw new Error(`GPU_CUT_BUFFER_UNNAMED`)
  admit(descriptor.size)
  return ledgerTentative(device, () => device.createBuffer(descriptor))
}

/** Bytes a ledger's labels give the cuts' tables (`CUT_LABEL`). */
export const cutLedgerBytes = (byLabel: Readonly<Record<string, number>>) =>
  Object.entries(byLabel).reduce(
    (sum, [label, bytes]) => sum + (label.startsWith(CUT_LABEL) ? bytes : 0),
    0,
  )

/** Bytes the cut's buffers hold, its readback ring's with them (`mainReadbacks.ts`). */
export const cutBytes = (resources: {
  buffers: readonly GPUBuffer[]
  readbacks?: { readonly bytes: number }
}) =>
  resources.buffers.reduce((sum, buffer) => sum + buffer.size, 0) +
  (resources.readbacks?.bytes ?? 0)
