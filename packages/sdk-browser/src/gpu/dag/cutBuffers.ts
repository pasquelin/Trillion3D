import { budgetRefused, ledgerTentative } from '../core/deviceLedger.ts'

/** The session's budget asked for a buffer of `bytes` more of the cut's tables: it throws, by its
 *  own name, when it cannot fund them. */
export type CutAdmission = (bytes: number) => void

/** Every buffer of a cut's tables starts so: what the budget counts as their share
 *  (`cutLedgerBytes`). */
const CUT_LABEL = 'Trillion3D DAG'

/** The name a cut's tables past their share are refused by. */
const PAST_SHARE = 'GPU_CUT_TABLES_PAST_SHARE'

/** The refusal of a cut whose tables would hold `bytes`, past its `share`: said by name. */
const pastShare = (bytes: number, share: number) => new Error(`${PAST_SHARE}: ${bytes} > ${share}`)

/** Whether `error` is a refusal `admitted` says by name: past the cut's share, or past the
 *  session's budget (`budgetRefused`). Any other error is no refusal. */
export const cutRefused = (error: unknown) =>
  String(error).includes(PAST_SHARE) || budgetRefused(error)

/**
 * A resource of a cut's tables — `bytes` large, named `label` —, beside the `held` bytes they hold:
 * within the `share`, the session's budget asked first (`admit`), and made tentatively on its
 * ledger — a refusal never refuses the session: the cut keeps the tables it holds (`listCap.ts`)
 * (`ledgerTentative`).
 */
function admitted<T>(
  device: GPUDevice,
  admit: CutAdmission,
  held: number,
  share: number,
  { label, bytes }: { label?: string; bytes: number },
  build: () => T,
) {
  if (held + bytes > share) throw pastShare(held + bytes, share)
  if (!label?.startsWith(CUT_LABEL)) throw new Error(`GPU_CUT_BUFFER_UNNAMED`)
  admit(bytes)
  return ledgerTentative(device, build)
}

/** Bytes a ledger's labels give the cuts' tables (`CUT_LABEL`). */
export const cutLedgerBytes = (byLabel: Readonly<Record<string, number>>) =>
  Object.entries(byLabel).reduce(
    (sum, [label, bytes]) => sum + (label.startsWith(CUT_LABEL) ? bytes : 0),
    0,
  )

/** Bytes the cut's buffers and record textures hold, its readback ring's with them
 *  (`mainReadbacks.ts`). */
export const cutBytes = (resources: {
  buffers: readonly GPUBuffer[]
  textures?: readonly { readonly bytes: number }[]
  readbacks?: { readonly bytes: number }
}) =>
  resources.buffers.reduce((sum, buffer) => sum + buffer.size, 0) +
  (resources.textures ?? []).reduce((sum, texture) => sum + texture.bytes, 0) +
  (resources.readbacks?.bytes ?? 0)

/** What a cut holds that a resource of its own is admitted against: its buffers, its record
 *  textures and its readback ring, and the bytes it keeps `aside` of them — a growth made beside
 *  the tables it replaces counts what stays of them so (`listCap.ts`, `queueGrowth.ts`). */
type CutHeld = {
  buffers: readonly GPUBuffer[]
  textures?: readonly { texture: GPUTexture; bytes: number }[]
  readbacks?: { readonly bytes: number }
  aside?: number
  device: GPUDevice
  admit: CutAdmission
  share: number
}
/** A cut whose buffers a resource made joins (`cutBuffer`, `cutTexture`). */
type CutHolder = CutHeld & { buffers: GPUBuffer[] }

/** Makes a record texture's texture, `bytes` large, in place of `old` when it replaces one. */
export type TextureMaker = (
  descriptor: GPUTextureDescriptor,
  bytes: number,
  old?: GPUTexture,
) => GPUTexture

/**
 * THE ONE ADMISSION OF A RESOURCE OF A CUT'S OWN (`admitted`): `made`, built by `build`, within
 * `cut`'s share beside what it holds, less the `freed` bytes of the one it replaces. Its buffers
 * and textures (`cutBuffer`, `cutTexture`), at its setup (`resources.ts`), its growths
 * (`listCap.ts`, `queueGrowth.ts`) and its readback ring (`mainReadbacks.ts`) all go through it.
 */
export const admitInto = <T>(
  cut: CutHeld,
  made: { label?: string; bytes: number },
  build: () => T,
  freed = 0,
) =>
  admitted(cut.device, cut.admit, cutBytes(cut) + (cut.aside ?? 0) - freed, cut.share, made, build)

/** A buffer of `cut`'s own (`admitInto`), `old`'s bytes leaving it, held in `old`'s place among
 *  its buffers — its dispose destroys it. */
export function cutBuffer(cut: CutHolder, descriptor: GPUBufferDescriptor, old?: GPUBuffer) {
  const made = { label: descriptor.label, bytes: descriptor.size }
  const buffer = admitInto(cut, made, () => cut.device.createBuffer(descriptor), old?.size)
  const at = old ? cut.buffers.indexOf(old) : -1
  if (at >= 0) cut.buffers.splice(at, 1, buffer)
  else cut.buffers.push(buffer)
  return buffer
}

/** A texture of `cut`'s own, `bytes` large, made as `cutBuffer` makes a buffer. */
export function cutTexture(
  cut: CutHolder & { textures: { texture: GPUTexture; bytes: number }[] },
  descriptor: GPUTextureDescriptor,
  bytes: number,
  old?: GPUTexture,
) {
  const at = old ? cut.textures.findIndex((held) => held.texture === old) : -1
  const made = { label: descriptor.label, bytes },
    freed = at >= 0 ? cut.textures[at].bytes : 0
  const texture = admitInto(cut, made, () => cut.device.createTexture(descriptor), freed)
  if (at >= 0) cut.textures.splice(at, 1, { texture, bytes })
  else cut.textures.push({ texture, bytes })
  return texture
}
