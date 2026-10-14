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
 * The one way a resource of a cut's tables is made — `bytes` large, named `label` —, beside the
 * `held` bytes they hold: within the `share`, the session's budget asked first (`admit`), and made
 * tentatively on its ledger — a refusal never refuses the session: the cut keeps the tables it
 * holds (`listCap.ts`) (`ledgerTentative`).
 */
export function admitted<T>(
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

/** A buffer of a cut's tables (`admitted`). */
export const madeAsked = (
  device: GPUDevice,
  admit: CutAdmission,
  held: number,
  share: number,
  descriptor: GPUBufferDescriptor,
) =>
  admitted(device, admit, held, share, { label: descriptor.label, bytes: descriptor.size }, () =>
    device.createBuffer(descriptor),
  )

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

/** What a cut holds that a resource of its own is admitted against (`cutBuffer`, `cutTexture`). */
type CutHolder = Parameters<typeof cutBytes>[0] & {
  buffers: GPUBuffer[]
  textures: { texture: GPUTexture; bytes: number }[]
  device: GPUDevice
  admit: CutAdmission
  share: number
}

/** Makes a buffer, in place of `old` when it replaces one: a cut's (`cutBuffer`). */
export type BufferMaker = (descriptor: GPUBufferDescriptor, old?: GPUBuffer) => GPUBuffer
/** Makes a record texture's texture, `bytes` large, in place of `old` when it replaces one. */
export type TextureMaker = (
  descriptor: GPUTextureDescriptor,
  bytes: number,
  old?: GPUTexture,
) => GPUTexture

/** A buffer of `cut`'s own made after its tables (`admitted`): within its share, `old`'s bytes
 *  leaving it, held in `old`'s place among its buffers — its dispose destroys it. */
export function cutBuffer(cut: CutHolder, descriptor: GPUBufferDescriptor, old?: GPUBuffer) {
  const held = cutBytes(cut) - (old?.size ?? 0)
  const buffer = madeAsked(cut.device, cut.admit, held, cut.share, descriptor)
  const at = old ? cut.buffers.indexOf(old) : -1
  if (at >= 0) cut.buffers.splice(at, 1, buffer)
  else cut.buffers.push(buffer)
  return buffer
}

/** A texture of `cut`'s own, `bytes` large, made as `cutBuffer` makes a buffer. */
export function cutTexture(
  cut: CutHolder,
  descriptor: GPUTextureDescriptor,
  bytes: number,
  old?: GPUTexture,
) {
  const at = old ? cut.textures.findIndex((held) => held.texture === old) : -1
  const held = cutBytes(cut) - (at >= 0 ? cut.textures[at].bytes : 0)
  const texture = admitted(
    cut.device,
    cut.admit,
    held,
    cut.share,
    { label: descriptor.label, bytes },
    () => cut.device.createTexture(descriptor),
  )
  if (at >= 0) cut.textures.splice(at, 1, { texture, bytes })
  else cut.textures.push({ texture, bytes })
  return texture
}
