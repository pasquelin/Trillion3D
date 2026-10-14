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

/** Whether `error` is a refusal `admitInto` says by name: past the cut's share, or past the
 *  session's budget (`budgetRefused`). Any other error is no refusal. */
export const cutRefused = (error: unknown) =>
  String(error).includes(PAST_SHARE) || budgetRefused(error)

/** Bytes a ledger's labels give the cuts' tables (`CUT_LABEL`). */
export const cutLedgerBytes = (byLabel: Readonly<Record<string, number>>) =>
  Object.entries(byLabel).reduce(
    (sum, [label, bytes]) => sum + (label.startsWith(CUT_LABEL) ? bytes : 0),
    0,
  )

/** What a cut holds that a resource of its own is admitted against: its buffers, its record
 *  textures and its readback ring once made (`mainReadbacks.ts`), its share and the budget each
 *  resource is asked of first. */
export type CutHeld = {
  buffers: readonly GPUBuffer[]
  textures: readonly { readonly bytes: number }[]
  readbacks?: { readonly bytes: number }
  device: GPUDevice
  admit: CutAdmission
  share: number
}
/** A cut whose buffers and textures a resource made joins (`cutBuffer`, `cutTexture`). */
type CutHolder = Omit<CutHeld, 'buffers' | 'textures'> & {
  buffers: GPUBuffer[]
  textures: { texture: GPUTexture; bytes: number }[]
}

/** THE CUT'S ONE BYTE LEDGER, read where its resources are held: its buffers, its record textures
 *  and its readback ring. */
export const cutBytes = (cut: CutHeld) =>
  cut.buffers.reduce((sum, buffer) => sum + buffer.size, 0) +
  cut.textures.reduce((sum, texture) => sum + texture.bytes, 0) +
  (cut.readbacks?.bytes ?? 0)

/**
 * THE ONE ADMISSION OF A RESOURCE OF A CUT'S OWN: `made`, `bytes` large and named `label`, built
 * by `build` within `cut`'s share beside what it holds (`cutBytes`) less the `freed` bytes its
 * making releases — the resources it replaces — and with the `beside` bytes a growth made or keeps
 * aside, which the cut does not hold yet (`admitBeside`); the cut's budget asked first (`admit`),
 * then made tentatively on the device's ledger (`ledgerTentative`): a refusal never refuses the
 * session, the cut keeps the tables it holds. Its buffers and textures (`cutBuffer`,
 * `cutTexture`), at its setup (`resources.ts`), its growths and its readback ring all go through it.
 */
export function admitInto<T>(
  cut: CutHeld,
  { label, bytes }: { label?: string; bytes: number },
  build: () => T,
  freed = 0,
  beside = 0,
) {
  const held = cutBytes(cut) - freed + beside + bytes
  if (held > cut.share) throw pastShare(held, cut.share)
  if (!label?.startsWith(CUT_LABEL)) throw new Error(`GPU_CUT_BUFFER_UNNAMED`)
  cut.admit(bytes)
  return ledgerTentative(cut.device, build)
}

/**
 * A growth's admission (`listGrowth.ts`, `queueGrowth.ts`): each resource it makes, in place of
 * the `freed` bytes it replaces, admitted (`admitInto`) beside the `reserved` bytes it keeps for
 * later and what it made so far, which the cut holds only once the growth commits. `made` holds
 * each resource made and its bytes, in order: what the growth puts in place, or frees refused.
 */
export function admitBeside<T>(cut: CutHeld, freed: number, reserved = 0) {
  const made: { resource: T; bytes: number }[] = []
  let beside = reserved
  return {
    made,
    admit(resource: { label?: string; bytes: number }, build: () => T) {
      const built = admitInto(cut, resource, build, freed, beside)
      beside += resource.bytes
      made.push({ resource: built, bytes: resource.bytes })
      return built
    },
  }
}

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
  cut: CutHolder,
  descriptor: GPUTextureDescriptor,
  bytes: number,
  old?: GPUTexture,
) {
  const { textures } = cut
  const at = old ? textures.findIndex((held) => held.texture === old) : -1
  const made = { label: descriptor.label, bytes },
    freed = at >= 0 ? textures[at].bytes : 0
  const texture = admitInto(cut, made, () => cut.device.createTexture(descriptor), freed)
  if (at >= 0) textures.splice(at, 1, { texture, bytes })
  else textures.push({ texture, bytes })
  return texture
}
