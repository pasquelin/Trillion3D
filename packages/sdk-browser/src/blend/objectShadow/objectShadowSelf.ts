import { alignUp, ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import {
  OBJECT_SHADOW_HEADER_ROWS,
  OBJECT_SHADOW_PACKED_WIDTH as WIDTH,
  OBJECT_SHADOW_RECORD_TEXELS,
  OBJECT_SHADOW_RECORD_WORDS,
  foldsDepth,
  foldsProfiles,
  readsAtlasTexture,
  type ObjectShadowAtlasRead,
} from '../../gpu/core/objectShadowRead.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { ObjectShadowFrame } from '../../lighting/shadows/perObject/objectShadowFrame.ts'
import { writeShadowTile } from '../../lighting/shadows/perObject/transmissionAtlas.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { deviceMade } from '../../gpu/core/errorScope.ts'
import { budgetRefused, ledgerTentative } from '../../gpu/core/deviceLedger.ts'
import { outOfMemoryContext } from '../../session/memory/outOfMemory.ts'
import { OBJECT_SHADOW_MATERIAL_VECS } from './objectShadowWgsl.ts'
import { objectShadowClipMatrix } from './objectShadowClip.ts'
import { layersDepth, layersSize } from '../reducedView.ts'
import {
  encodeDepthFold,
  foldedDepthRows,
  newDepthFoldState,
  depthFoldReady,
  releaseDepthFold,
  sortsFoldedDepth,
  type DepthFoldState,
} from './objectShadowDepthFold.ts'
import { copyBufferToTableRows, packedTableSize, writeTableRows } from './objectShadowTable.ts'

/**
 * THE RESOURCES OF THE TRANSLUCENT SURFACES' OWN SHADOW (`objectShadowSelfWgsl.ts`), a view's: once the depth pass has drawn the subjects, each item whose object
 * casts a sun's translucent shadow is given a record, one per (subject, material) pair and as many as the frame holds: the subject's light frame, the rectangle of its
 * coefficients, the sun's direction and fade, and the material's self shadow scales. Everything lives in one packed table (`rgba32uint`, rows added as the
 * frame needs them, a 2D array past a layer's rows): the words naming each item's record (the record's first texel plus one, 0 for none), which the blend's vertex stage reads,
 * the records, then the light profiles' atlas where the device folds it, and, where the device cannot spare the second sampled texture for the atlas, the atlas rectangles of the
 * subjects, copied into it after the passes that drew them (two texels of a layer to a packed texel; a rectangle wider than the table's rows in blocks). The sun's subject is the last one the frame holds for the object (a primitive reads one directional shadow,
 * as the last translucent shadow of the frame set it). A frame where the depth pass did not run binds the stand-ins, which shadow nothing.
 */

/** What the blends bind (`BlendLighting.objectShadow`). */
interface ObjectShadowReadResources {
  readonly atlas?: GPUBindingResource
  readonly packed: GPUTextureView
}

/** A texel of the atlas: four half floats. */
const TEXEL_BYTES = 8
/** A packed texel: four words. */
const PACKED_TEXEL_WORDS = 4
const ROW_ALIGN = 256
/** A row of the packed table, in bytes. */
const ROW_BYTES = WIDTH * 16
const ROW_WORDS = WIDTH * PACKED_TEXEL_WORDS
/** A record's key is its subject's rank times this plus its material's: past any count of materials (2^30), exact as a number. */
const KEY_SUBJECT = 2 ** 30

const standIns = oncePerDevice((device: GPUDevice) => ({
  atlasView: standInTexture(
    device,
    'Trillion3D translucent object shadow stand-in',
    'rgba16float',
    { layers: 2 },
  ).createView({ dimension: '2d-array' }),
  packed: standInTexture(
    device,
    'Trillion3D translucent object shadow packed stand-in',
    'rgba32uint',
  ).createView({ dimension: '2d-array' }),
}))

/** How the session's blends in place read the atlas (their layouts hold it): none where the programs in place do not read the object's shadow. */
const atlasReadOf = (rt: WebgpuPagesRuntime): ObjectShadowAtlasRead | undefined =>
  rt.vis.blendPipelines?.objectShadowRead

/** The stand-ins a device binds where no record is made: nothing in the table, an atlas of nothing. */
function standInResources(
  device: GPUDevice,
  read: ObjectShadowAtlasRead,
): ObjectShadowReadResources {
  const s = standIns(device)
  return { atlas: readsAtlasTexture(read) ? s.atlasView : undefined, packed: s.packed }
}

/**
 * What the copies of the atlas rectangles take in the table and in the staging buffer: the rows and the shelf cursor of the 2D packing (a rectangle's strips of rows go side by side along
 * a shelf of the table's width, a new shelf under it when the width is spent), and the bytes of the largest band one copy goes through the staging buffer in (`cap`: under the device's buffer size).
 */
interface Staged {
  bytes: number
  rows: number
  x: number
  top: number
  shelf: number
  cap: number
}
/** The most one staging band takes, under the device's `maxBufferSize`. */
const STAGING_BAND_BYTES = 2 ** 26
/** The view's one `Staged`, its counts put back to zero (the cap is worked out once). */
const stagedOf = (device: GPUDevice, kit: Kit): Staged => {
  const staged = (kit.staged ??= {
    bytes: 0,
    rows: 0,
    x: 0,
    top: 0,
    shelf: 0,
    cap: Math.min(device.limits.maxBufferSize ?? STAGING_BAND_BYTES, STAGING_BAND_BYTES),
  })
  staged.bytes = staged.rows = staged.x = staged.top = staged.shelf = 0
  return staged
}

/** A rectangle of a subject copied into the packed table: where it lies in the atlas, and where in the staging buffer and the table. */
interface Copy {
  layer: number
  x: number
  y: number
  width: number
  height: number
  bytesPerRow: number
  /** The first row of its first plane, from the first row of the atlas region, and the texel of that row it starts at (rectangles lie side by side in shelves). */
  row: number
  col: number
  /** The blocks of columns it is cut into (`2 * WIDTH` texels of the atlas each, the last the rest): each holds its two planes, one after the other. */
  blocks: number
}

interface Kit {
  readonly device: GPUDevice
  /** The packed table, its view and the rows it holds (the lines of its layers, whole). */
  packed: GPUTexture | undefined
  packedView: GPUTextureView | undefined
  packedRows: number
  /** Whether the table was made to be written by a pass (`STORAGE_BINDING`, the folded depth), and the rows (and usage) the device refused to make one for: not tried again until fewer are asked. */
  packedStorage: boolean
  /** The rows of the table the device refused to make (the size asked, margin included), and the usage: not tried again at that many rows or more; fewer are asked exactly, before any margin. */
  refused: number
  refusedStorage: boolean
  /** The table being made aside (one at a time), adopted at the start of an image once the device granted it; the frame where the adoption was last looked at. */
  pending: PendingTable | undefined
  adopted: number
  /** What the image's layout holds that no record changes (the profiles' and the depth's rows), worked out once for the image. */
  shape: Shape | undefined
  /** The row the atlas rectangles were last copied to in this table (none while 0 or the table is new). */
  copyAt: number
  /** The words of the item table and the records, and what the table holds of them. */
  words: Uint32Array<ArrayBuffer>
  floats: Float32Array
  sent: Uint32Array
  /** The words of `sent` that hold what the table holds. */
  sentLength: number
  staged: Staged | undefined
  staging: GPUBuffer | undefined
  /** The folded read: the buffer the profiles' atlas is copied through, the header texel's words and what the table holds of them. */
  profileStaging: GPUBuffer | undefined
  readonly header: Uint32Array<ArrayBuffer>
  /** The sorted translucency's depth folded into the table (`'foldedDepth'`): the pass's state, and where the depth lies (its row, none while 0). */
  readonly depthFold: DepthFoldState
  depthRow: number
  depthSize: readonly [number, number]
  headerSent: Uint32Array<ArrayBuffer> | undefined
  /** The row the records were sent to with `sent`. */
  sentAt: number
  /** Whether the table holds the profiles (the folded read), and what was last copied into it: the atlas's texture and writes, and the row it went to. */
  folded: boolean
  profileCopy: { texture: GPUTexture; writes: number; row: number } | undefined
  /** The image the records were made for, and what they bind. */
  frame: number
  live: ObjectShadowReadResources | undefined
  /** The (subject, material) pairs of the image and their record. */
  readonly keys: Map<number, number>
  /** The sun's subject of each caster of the image. */
  readonly subjectOf: Map<number, number>
  /** The subjects whose rectangle the packed read copied, with their copy. */
  readonly copied: Map<number, Copy>
  /** The copies to encode, held and refilled: the first `copyCount`. */
  readonly copies: Copy[]
  copyCount: number
}
const kits = new WeakMap<object, Kit>()

function kitOf(rt: WebgpuPagesRuntime, device: GPUDevice): Kit {
  const key = viewKey(rt.gpu)
  let kit = kits.get(key)
  if (kit?.device !== device) {
    if (kit) releaseKit(kit)
    const words = new Uint32Array(ROW_WORDS)
    kits.set(
      key,
      (kit = {
        device,
        packed: undefined,
        packedView: undefined,
        packedRows: 0,
        packedStorage: false,
        refused: 0,
        refusedStorage: false,
        pending: undefined,
        adopted: -1,
        shape: undefined,
        sentAt: -1,
        copyAt: -1,
        words,
        floats: new Float32Array(words.buffer),
        sent: new Uint32Array(0),
        sentLength: -1,
        staged: undefined,
        staging: undefined,
        profileStaging: undefined,
        header: new Uint32Array(8),
        depthFold: newDepthFoldState(),
        depthRow: 0,
        depthSize: [0, 0],
        headerSent: undefined,
        folded: false,
        profileCopy: undefined,
        frame: -1,
        live: undefined,
        keys: new Map(),
        subjectOf: new Map(),
        copied: new Map(),
        copies: [],
        copyCount: 0,
      }),
    )
  }
  return kit
}

function releaseKit(kit: Kit) {
  if (kit.pending) {
    kit.pending.stale = true
    kit.pending.made?.texture.destroy()
    kit.pending = undefined
  }
  if (kit.packed) retire(kit.device, kit.packed)
  if (kit.staging) retire(kit.device, kit.staging)
  if (kit.profileStaging) retire(kit.device, kit.profileStaging)
  releaseDepthFold(kit.device, kit.depthFold)
}

/**
 * Lets go of the view's table (retired: the image's commands may still name it). With `keepProfiles`, a table that holds the light profiles stays (the programs still read
 * them from it, a view without a shadow context draws as well): only the image's records go.
 */
export function releaseObjectShadowRead(gpu: { viewKey?: object }, keepProfiles = false) {
  const key = viewKey(gpu)
  const kit = kits.get(key)
  if (!kit) return
  if (keepProfiles && kit.folded) {
    kit.frame = -1
    return
  }
  releaseKit(kit)
  kits.delete(key)
}

/** What the blends bind this image: the table the depth pass published, or the stand-ins. */
export function objectShadowReadResources(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
): ObjectShadowReadResources | undefined {
  const read = atlasReadOf(rt)
  if (!read) return undefined
  const kit = kits.get(viewKey(rt.gpu))
  if (kit?.frame === rt.run.frame && kit.live) return kit.live
  // The folded read keeps the light profiles in the table, the sky's surfaces' too: an image without a subject folds them alone (no record, the item table zero).
  if (foldsProfiles(read) && (profilesOf(rt) || foldsDepth(read))) {
    const own = kitOf(rt, device)
    publishProfiles(rt, device, own, read)
    if (own.frame === rt.run.frame && own.live) return own.live
  }
  return standInResources(device, read)
}

/** What the depth pass knows of the items: the caster each item belongs to (its place in the feed's list plus one, 0 for none), the materials' rows and each item's material rank. */
interface ObjectShadowReadInput {
  readonly casting: Uint32Array
  readonly count: number
  readonly materialRank: (item: number) => number
  readonly materialWords: Float32Array
}

const put4 = (
  out: { [index: number]: number },
  at: number,
  a: number,
  b: number,
  c: number,
  d: number,
) => {
  out[at] = a
  out[at + 1] = b
  out[at + 2] = c
  out[at + 3] = d
}

/** The copy of subject `k`'s rectangle, made once whatever the records it has (the packed read): sized in the staging buffer and in rows of the atlas region. */
function copyOf(
  kit: Kit,
  k: number,
  layer: number,
  x: number,
  y: number,
  width: number,
  height: number,
  staged: Staged,
) {
  let copy = kit.copied.get(k)
  if (copy) return copy
  copy = kit.copies[kit.copyCount++] ??= {
    layer: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    bytesPerRow: 0,
    row: 0,
    col: 0,
    blocks: 0,
  }
  copy.layer = layer
  copy.x = x
  copy.y = y
  copy.width = width
  copy.height = height
  // A packed texel is two texels of the atlas: a row holds an even count of them, and at most the table's width of packed texels.
  copy.blocks = ceilDiv(width, 2 * WIDTH)
  copy.bytesPerRow = alignUp(Math.min(width + (width & 1), 2 * WIDTH) * TEXEL_BYTES, ROW_ALIGN)
  // The rectangle is a strip of `blocks * 2 * height` rows, as wide as its widest block: laid along the shelf, or on a new one under it where the width is spent.
  const wide = Math.min(ceilDiv(width, 2), WIDTH)
  const strip = copy.blocks * 2 * height
  if (staged.x + wide > WIDTH) {
    staged.top += staged.shelf
    staged.x = 0
    staged.shelf = 0
  }
  copy.row = staged.top
  copy.col = staged.x
  staged.x += wide
  staged.shelf = Math.max(staged.shelf, strip)
  staged.rows = staged.top + staged.shelf
  // One band at a time goes through the staging buffer, whole rows of it, within the device's buffer size.
  const band = Math.max(1, Math.floor(staged.cap / copy.bytesPerRow))
  staged.bytes = Math.max(staged.bytes, Math.min(height, band) * copy.bytesPerRow)
  kit.copied.set(k, copy)
  return copy
}

/**
 * Publishes the image's records: from `frame`'s sun subjects and `input`'s items, written into the view's packed table, and, in the packed read, the copies of the
 * subjects' rectangles encoded into `encoder` (after the passes that drew them; not when the atlases are as the last image left them, `atlasChanged` false, unless the table was made again
 * or the rectangles' rows moved). Returns whether anything is bound for the image.
 */
export function publishObjectShadowRead(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  frame: ObjectShadowFrame,
  input: ObjectShadowReadInput,
  atlasChanged = true,
) {
  const read = atlasReadOf(rt)
  if (!read) return false
  const kit = kitOf(rt, device)
  kit.frame = -1
  const { casting, count } = input
  // The sun's subject of each caster (by its place in the feed's list): the last directional one that was given a slot.
  const subjectOf = kit.subjectOf
  subjectOf.clear()
  frame.subjects.forEach((subject, k) => {
    if (subject.projection.directional && frame.suns.has(subject.lightId) && frame.atlases.slots[k])
      subjectOf.set(subject.place, k)
  })
  // The item table takes the first rows, a word an item; the records follow it.
  const itemRows = Math.max(1, ceilDiv(count, ROW_WORDS))
  const recordsAt = itemRows * ROW_WORDS
  kit.words = resized(kit.words, recordsAt + OBJECT_SHADOW_RECORD_WORDS)
  if (kit.floats.buffer !== kit.words.buffer) kit.floats = new Float32Array(kit.words.buffer)
  kit.words.fill(0, 0, recordsAt)
  kit.keys.clear()
  kit.copied.clear()
  kit.copyCount = 0
  const staged = stagedOf(device, kit)
  let records = 0
  const rowWords = OBJECT_SHADOW_MATERIAL_VECS * 4
  for (let i = 0; i < count; i++) {
    const place = casting[i]! - 1
    if (place < 0) continue
    const k = subjectOf.get(place)
    if (k === undefined) continue
    const material = input.materialRank(i)
    const key = k * KEY_SUBJECT + material
    let record = kit.keys.get(key)
    if (record === undefined) {
      const subject = frame.subjects[k]!
      const slot = frame.atlases.slots[k]!
      const atlas = frame.atlases.atlases[slot.atlas]!
      const p = subject.projection
      const width = p.resolutionX + 2 * p.border
      const height = p.resolutionY + 2 * p.border
      record = records++
      kit.keys.set(key, record)
      kit.words = resized(kit.words, recordsAt + records * OBJECT_SHADOW_RECORD_WORDS)
      if (kit.floats.buffer !== kit.words.buffer) kit.floats = new Float32Array(kit.words.buffer)
      const sun = frame.suns.get(subject.lightId)!
      const at = recordsAt + record * OBJECT_SHADOW_RECORD_WORDS
      const uu = kit.words
      const ff = kit.floats
      objectShadowClipMatrix(p, ff, at)
      const side = atlas.side
      writeShadowTile(ff, at + 16, at + 20, p, slot, side)
      put4(ff, at + 24, p.invMaxSubjectDepth, 0, 0, 0)
      put4(ff, at + 28, sun.direction[0], sun.direction[1], sun.direction[2], subject.fade)
      const m = material * rowWords
      const w = input.materialWords
      put4(ff, at + 32, w[m + 2]!, w[m + 3]!, w[m + 4]!, w[m + 5]!)
      put4(ff, at + 36, w[m + 8]!, w[m + 9]!, w[m + 10]!, side)
      put4(uu, at + 40, atlas.layer, sun.slot, slot.x, slot.y)
      // The row of the copy is told once the records' rows are known.
      const copy = !readsAtlasTexture(read)
        ? copyOf(kit, k, atlas.layer, slot.x, slot.y, width, height, staged)
        : undefined
      put4(uu, at + 44, copy?.row ?? 0, copy?.col ?? 0, width, height)
    }
    // The record's first texel of the table, plus one.
    kit.words[i] = itemRows * WIDTH + record * OBJECT_SHADOW_RECORD_TEXELS + 1
  }
  return uploadTable(rt, device, () => encoder, kit, read, {
    itemRows,
    recordsAt,
    records,
    staged,
    atlas: frame.atlases,
    atlasChanged,
  })
}

/** What a published table is made of: the item table's rows, the records, the atlas copies' size and the atlas the copies read (none without copies). */
interface TableLayout {
  itemRows: number
  recordsAt: number
  records: number
  staged: Staged
  atlas?: Pick<ObjectShadowFrame['atlases'], 'texture' | 'array'>
  /** Whether the atlases were drawn this image: the rectangles are copied again (else only where the table or their rows are new). */
  atlasChanged?: boolean
}

/** The light profiles' atlas to fold into the table: its texture, side and slices, none while it holds none. */
const profilesOf = (rt: WebgpuPagesRuntime) => rt.lights.lightProfile?.atlas.figures()

const refusals = new WeakSet<GPUDevice>()

/** A table the device was asked for aside from the frame: settled once it answered, `made` where it granted it, `stale` where the view let go meanwhile. */
interface PendingTable {
  settled: boolean
  stale: boolean
  /** Whether the images wait for it: the table in place (if any) cannot hold what they publish, so they bind nothing until it is adopted (`objectShadowTableAwaited`). */
  needed: boolean
  /** Settles when the device answered (granted or refused). */
  done?: Promise<void>
  made?: { texture: GPUTexture; view: GPUTextureView; rows: number; storage: boolean }
}

/** What an image's layout holds that the records do not change: the profiles' atlas and its rows, the sorted depth's size and rows. */
interface Shape {
  frame: number
  read: ObjectShadowAtlasRead
  profiles: ReturnType<typeof profilesOf>
  side: number
  stride: number
  profileBytes: number
  profileRows: number
  depthWidth: number
  depthHeight: number
  depthRows: number
}

/** The shape of the image's layout, worked out by the first caller of the image (the profiles' publication, or the depth pass's) and reused by the second. */
function shapeOf(rt: WebgpuPagesRuntime, device: GPUDevice, kit: Kit, read: ObjectShadowAtlasRead) {
  const held = kit.shape
  if (held?.frame === rt.run.frame && held.read === read) return held
  const profiles = foldsProfiles(read) ? profilesOf(rt) : undefined
  const side = profiles?.side ?? 0
  const stride = alignUp(2 * side, ROW_ALIGN)
  const profileBytes = profiles ? profiles.slices * side * stride : 0
  // The sorted translucency's depth, after the profiles (the `'foldedDepth'` read): its rows are reserved in a frame that sorts, and announced once the pass that writes it is compiled.
  const [depthWidth, depthHeight] =
    foldsDepth(read) && sortsFoldedDepth(rt, device) ? layersSize(rt.gpu) : NO_DEPTH
  return (kit.shape = {
    frame: rt.run.frame,
    read,
    profiles,
    side,
    stride,
    profileBytes,
    profileRows: ceilDiv(profileBytes, WIDTH * TEXEL_WORDS_BYTES),
    depthWidth,
    depthHeight,
    depthRows: foldedDepthRows(depthWidth, depthHeight),
  })
}

/** What `make` allocates when the device and the memory budget grant it (the engine's grant, as the sorted translucency's pool): none when either refuses. */
async function granted<R extends { destroy(): void }>(device: GPUDevice, make: () => R) {
  try {
    return await deviceMade(device, () => ledgerTentative(device, make))
  } catch (error) {
    if (budgetRefused(error)) return undefined
    throw error
  }
}

/**
 * Asks the device, aside from the frame, for a packed table of `rows` rows (grown by half again over `held` rows, whole layers past one), under an out-of-memory scope and tentatively on the memory
 * budget. The table is adopted at the start of an image once granted (`adoptTable`), never used before, and the one the view had is retired only then: a table the layers cannot hold, or the device
 * refuses, leaves the one the view had. One is asked at a time. A refusal records the size that failed, is told once a device as a `gpu-out-of-memory` diagnostic, and is not asked again at that many rows
 * or more; fewer rows are asked exactly, before any margin.
 */
function askTable(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  kit: Kit,
  rows: number,
  storage: boolean,
  held: number,
) {
  if (kit.pending) return
  const retry = kit.refused > 0 && kit.refusedStorage === storage
  if (retry && rows >= kit.refused) return
  const made = packedTableSize(rows, retry ? 0 : held, device.limits.maxTextureArrayLayers)
  const refuse = (why: string, failed: number) => {
    kit.refused = failed
    kit.refusedStorage = storage
    if (refusals.has(device)) return
    refusals.add(device)
    rt.diag.engineDiagnostic(
      'gpu-out-of-memory',
      `Translucent object shadows: ${why}, the surfaces take no shadow of their own`,
      outOfMemoryContext('shadow', failed * ROW_BYTES),
    )
  }
  // A table smaller than the rows asked would be written out of its bounds.
  if (made.rows < rows) {
    refuse(`the packed table needs ${rows} rows, the device holds ${made.rows}`, rows)
    return
  }
  const pending: PendingTable = { settled: false, stale: false, needed: false }
  kit.pending = pending
  const make = () =>
    device.createTexture({
      label: 'Trillion3D translucent object shadow packed table',
      size: made.size,
      format: 'rgba32uint',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        (storage ? GPUTextureUsage.STORAGE_BINDING : 0),
    })
  pending.done = granted(device, make).then(
    (texture) => {
      pending.settled = true
      if (pending.stale || kit.pending !== pending) return void texture?.destroy()
      if (!texture) {
        kit.pending = undefined
        refuse(`the device is out of memory for a ${made.size.join(' x ')} table`, made.rows)
        return
      }
      pending.made = {
        texture,
        view: texture.createView({ dimension: '2d-array' }),
        rows: made.rows,
        storage,
      }
    },
    () => {
      pending.settled = true
      if (kit.pending !== pending) return
      kit.pending = undefined
      refuse('the device could not make the table', made.rows)
    },
  )
}

/**
 * Adopts the table the device granted since, at the first publication of an image: the table the view had is retired (the earlier images' commands may still name it) and everything written
 * into it is written again into the new one. Never between the publications of one image.
 */
function adoptTable(rt: WebgpuPagesRuntime, device: GPUDevice, kit: Kit) {
  if (kit.adopted === rt.run.frame) return
  kit.adopted = rt.run.frame
  const made = kit.pending?.made
  if (!made) return
  kit.pending = undefined
  if (kit.packed) retire(device, kit.packed)
  kit.packed = made.texture
  kit.packedView = made.view
  kit.packedRows = made.rows
  kit.packedStorage = made.storage
  kit.refused = 0
  kit.sentLength = -1
  kit.sentAt = -1
  kit.headerSent = undefined
  kit.profileCopy = undefined
  kit.copyAt = -1
}

/**
 * Writes the table (the item table, the records, the header and the profiles of the folded read) into the view's packed texture, grown as the rows need (whole layers
 * past one, made aside and adopted at an image's start: a table too small or of the wrong usage waits for its successor, and the image binds nothing of the records), and encodes the copies of the atlas rectangles, and of the profiles' atlas where it moved, into the encoder `encoderOf` gives (made only if a copy is asked).
 * The order of the rows: the header, the item table, the profiles, the sorted depth (what no record moves), then the records and the atlas rectangles, which change with every image. Returns true: the image binds the table.
 */
function uploadTable(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoderOf: () => GPUCommandEncoder,
  kit: Kit,
  read: ObjectShadowAtlasRead,
  { itemRows, recordsAt, records, staged, atlas, atlasChanged = true }: TableLayout,
) {
  adoptTable(rt, device, kit)
  const folded = foldsProfiles(read)
  const head = folded ? OBJECT_SHADOW_HEADER_ROWS : 0
  const recordRows = ceilDiv(records * OBJECT_SHADOW_RECORD_TEXELS, WIDTH)
  const shape = shapeOf(rt, device, kit, read)
  const { profiles, side, stride, profileBytes, profileRows } = shape
  const storage = foldsDepth(read)
  // A table in place that cannot be written by a pass serves the image without the sorted depth's rows while the table that can is made aside: its records are bound all the same.
  const upgrade = storage && !!kit.packed && !kit.packedStorage
  const [depthWidth, depthHeight, depthRows] = upgrade
    ? [0, 0, 0]
    : [shape.depthWidth, shape.depthHeight, shape.depthRows]
  const profileRow = head + itemRows
  const depthRow = depthRows > 0 ? profileRow + profileRows : 0
  const recordsRow = profileRow + profileRows + depthRows
  const atlasRow = recordsRow + recordRows
  const rows = atlasRow + staged.rows
  // The words naming the records count from the header: the records lie past the profiles and the depth.
  const gap = (profileRows + depthRows) * WIDTH
  if (gap > 0) for (let w = 0; w < recordsAt; w++) if (kit.words[w] !== 0) kit.words[w] += gap
  // The last row of records is whole, its end zero.
  const used = recordsAt + recordRows * ROW_WORDS
  kit.words = resized(kit.words, used)
  const words = kit.words
  words.fill(0, recordsAt + records * OBJECT_SHADOW_RECORD_WORDS, used)
  if (!readsAtlasTexture(read))
    for (let r = 0; r < records; r++)
      words[recordsAt + r * OBJECT_SHADOW_RECORD_WORDS + 44] += atlasRow
  // A table in place serves whatever its usage allows: a table that can be written by a pass serves the read that does not write it too.
  const sized = !!kit.packed && kit.packedRows >= rows
  // Made aside, at the rows asked and half again, or, for a usage alone, at the size held; the table in place is kept (and serves the rows it holds) meanwhile.
  if (upgrade) {
    const full = rows + shape.depthRows
    askTable(
      rt,
      device,
      kit,
      Math.max(kit.packedRows, full),
      true,
      full > kit.packedRows ? kit.packedRows : 0,
    )
  } else if (!sized) askTable(rt, device, kit, rows, storage, kit.packedRows)
  if (!sized) {
    // The records do not fit the table in place: the images wait for the new one (the device answer), never drawn without them.
    if (kit.pending) kit.pending.needed = true
    return false
  }
  const table = kit.packed!
  kit.folded = folded
  // The item table and the records, rewritten where they moved or the table was made again.
  let moved = kit.sentLength !== used || kit.sentAt !== recordsRow
  for (let w = 0; !moved && w < used; w++) moved = words[w] !== kit.sent[w]
  if (moved) {
    if (recordsRow === head + itemRows)
      writeTableRows(device, table, words, head, itemRows + recordRows)
    else {
      writeTableRows(device, table, words.subarray(0, recordsAt), head, itemRows)
      if (recordRows > 0)
        writeTableRows(device, table, words.subarray(recordsAt, used), recordsRow, recordRows)
    }
    if (kit.sent.length < used) kit.sent = new Uint32Array(Math.max(used, kit.sent.length * 2))
    kit.sent.set(words.subarray(0, used))
    kit.sentLength = used
    kit.sentAt = recordsRow
  }
  if (folded) {
    const h = kit.header
    h[0] = profileRow
    h[1] = side
    h[2] = stride / 2
    h[3] = profiles && profileRows > 0 ? profiles.slices : 0
    h[4] = depthRow
    h[5] = depthWidth
    h[6] = depthHeight
    if (!kit.headerSent || h.some((word, k) => word !== kit.headerSent![k])) {
      device.queue.writeTexture({ texture: table }, h, { bytesPerRow: 32 }, [2, 1])
      kit.headerSent = h.slice()
    }
  }
  // The rectangles are copied again when the depth pass drew them this image, the table is new (adopted, `copyAt` forgotten) or their rows moved.
  if (!readsAtlasTexture(read) && (atlasChanged || kit.copyAt !== atlasRow)) {
    kit.copyAt = atlasRow
    const staging = (kit.staging = sizedBuffer(
      device,
      kit.staging,
      Math.max(staged.bytes, ROW_ALIGN),
      GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      'Trillion3D translucent object shadow atlas staging',
    ))
    for (let c = 0; c < kit.copyCount; c++) {
      const { layer, x, y, width, height, bytesPerRow, row, col, blocks } = kit.copies[c]!
      const encoder = encoderOf()
      // Bands of whole rows, each through the start of the staging buffer (the copies run in the order encoded): none past the device's buffer size.
      const band = Math.max(1, Math.floor(staged.cap / bytesPerRow))
      for (let block = 0; block < blocks; block++) {
        // The block's columns of the rectangle, then its two planes one above the other.
        const first = block * 2 * WIDTH
        const across = Math.min(width - first, 2 * WIDTH)
        for (let plane = 0; plane < 2; plane++) {
          const part = block * 2 + plane
          for (let top = 0; top < height; top += band) {
            const rows = Math.min(band, height - top)
            encoder.copyTextureToBuffer(
              { texture: atlas!.texture, origin: { x: x + first, y: y + top, z: layer + plane } },
              { buffer: staging, offset: 0, bytesPerRow },
              { width: across, height: rows },
            )
            copyBufferToTableRows(
              encoder,
              staging,
              0,
              bytesPerRow,
              table,
              ceilDiv(across, 2),
              atlasRow + row + part * height + top,
              rows,
              col,
            )
          }
        }
      }
    }
  }
  if (profiles && profileRows > 0) {
    const copied = kit.profileCopy
    // Copied again only when the atlas's texture or texels changed, the rows it goes to moved, or the table was made again.
    if (
      copied?.texture !== profiles.texture ||
      copied.writes !== profiles.writes ||
      copied.row !== profileRow
    ) {
      foldProfiles(device, encoderOf(), kit, profiles, profileRow, profileBytes, stride, staged.cap)
      kit.profileCopy = { texture: profiles.texture, writes: profiles.writes, row: profileRow }
    }
  } else kit.profileCopy = undefined
  kit.depthRow = depthRow
  kit.depthSize = [depthWidth, depthHeight]
  kit.live = {
    atlas: readsAtlasTexture(read) ? atlas!.array : undefined,
    packed: kit.packedView!,
  }
  kit.frame = rt.run.frame
  return true
}

/** The answer the device still owes the view's images: the packed table made aside that the records need (the first one, or one that grows), settled once granted or refused. None otherwise. */
export const objectShadowTableAwaited = (rt: WebgpuPagesRuntime) => {
  const pending = kits.get(viewKey(rt.gpu))?.pending
  return pending?.needed && !pending.settled ? pending.done : undefined
}

/** A texel of the table: four words. */
const TEXEL_WORDS_BYTES = 16
const NO_DEPTH: readonly [number, number] = [0, 0]

/**
 * Writes the sorted translucency's depth (`depth`, a view of the size the layers are drawn at) into the table's rows of it, ahead of the pass that collects (`'foldedDepth'`): the
 * fragments read it from there. Nothing where this image holds no table of the kind.
 */
export function foldOitDepth(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const kit = kits.get(viewKey(rt.gpu))
  if (kit?.frame !== rt.run.frame || !kit.depthRow || !kit.packedView) return false
  return encodeDepthFold(
    device,
    encoder,
    kit.depthFold,
    layersDepth(rt.gpu),
    kit.packedView,
    kit.depthSize[0],
    kit.depthSize[1],
    kit.depthRow,
  )
}

/**
 * Whether this image's table holds the sorted depth's rows (the table published, the depth announced, the pass that writes it compiled where it is asked): the sorted translucency
 * takes its layers out of the blends' pass only where it is, with the same predicate `foldOitDepth` answers by. Publishes the table of the image where no depth pass did (the profiles alone).
 */
export function foldedDepthPublished(rt: WebgpuPagesRuntime, device: GPUDevice) {
  objectShadowReadResources(rt, device)
  const kit = kits.get(viewKey(rt.gpu))
  return kit?.frame === rt.run.frame && !!kit.depthRow && !!kit.packedView && depthFoldReady(device)
}

/**
 * The profiles' atlas copied into the table at `row`, its bytes as they lie in the texture (a slice after the other, a row of `stride` bytes), through a buffer that
 * reads the texture and is read as rows of the table; the last row is partial. Bands of whole texture rows go through the start of the staging buffer one after the other
 * (the copies run in the order encoded), each within the device's buffer size (`cap`, as the rectangles' bands), and land in the table where their bytes belong, a band's first or last table row partial.
 */
function foldProfiles(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  kit: Kit,
  { texture, side, slices }: NonNullable<ReturnType<typeof profilesOf>>,
  row: number,
  bytes: number,
  stride: number,
  cap: number,
) {
  const band = Math.max(1, Math.floor(cap / stride))
  const staging = (kit.profileStaging = sizedBuffer(
    device,
    kit.profileStaging,
    Math.min(bytes, band * stride),
    GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    'Trillion3D translucent object shadow profiles staging',
  ))
  for (let slice = 0; slice < slices; slice++)
    for (let top = 0; top < side; top += band) {
      const rows = Math.min(band, side - top)
      encoder.copyTextureToBuffer(
        { texture, origin: { x: 0, y: top, z: slice } },
        { buffer: staging, offset: 0, bytesPerRow: stride },
        { width: side, height: rows },
      )
      // The band's bytes in the table's rows, from where the slices before it end.
      copyBytesToTable(
        encoder,
        staging,
        rows * stride,
        kit.packed!,
        row * ROW_BYTES + (slice * side + top) * stride,
      )
    }
}

/** `bytes` bytes at the start of `buffer` copied into the table from byte `at` of its rows (a multiple of a texel): whole rows where they lie whole, the partial rows at either end apart. */
function copyBytesToTable(
  encoder: GPUCommandEncoder,
  buffer: GPUBuffer,
  bytes: number,
  texture: GPUTexture,
  at: number,
) {
  for (let done = 0; done < bytes;) {
    const place = at + done
    const first = Math.floor(place / ROW_BYTES)
    const x = (place % ROW_BYTES) / TEXEL_WORDS_BYTES
    const left = bytes - done
    if (x === 0 && left >= ROW_BYTES) {
      const whole = Math.floor(left / ROW_BYTES)
      copyBufferToTableRows(encoder, buffer, done, ROW_BYTES, texture, WIDTH, first, whole)
      done += whole * ROW_BYTES
    } else {
      const part = Math.min(left, ROW_BYTES - x * TEXEL_WORDS_BYTES)
      copyBufferToTableRows(
        encoder,
        buffer,
        done,
        ROW_BYTES,
        texture,
        part / TEXEL_WORDS_BYTES,
        first,
        1,
        x,
      )
      done += part
    }
  }
}

/**
 * The folded read's table of an image whose depth pass drew no subject: no item has a record (the item table is sized to the items, all zero), the profiles are folded in as
 * ever (a light's profile is read from the table whether or not anything casts). The table stays between images; a command buffer of its own, submitted at once ahead of the
 * image's, is made only when the profiles' atlas moved. Nothing where the read is not folded or the table of this image is already made.
 */
function publishProfiles(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  kit: Kit,
  read: ObjectShadowAtlasRead,
) {
  let encoder: GPUCommandEncoder | undefined
  const itemRows = Math.max(1, ceilDiv(rt.blendState.blendGpu.length, ROW_WORDS))
  kit.words = resized(kit.words, itemRows * ROW_WORDS)
  kit.words.fill(0, 0, itemRows * ROW_WORDS)
  kit.keys.clear()
  kit.copied.clear()
  kit.copyCount = 0
  uploadTable(
    rt,
    device,
    () =>
      (encoder ??= device.createCommandEncoder({
        label: 'Trillion3D translucent object shadow profiles',
      })),
    kit,
    read,
    {
      itemRows,
      recordsAt: itemRows * ROW_WORDS,
      records: 0,
      staged: stagedOf(device, kit),
    },
  )
  if (encoder) device.queue.submit([encoder.finish()])
}
