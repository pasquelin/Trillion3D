import { blocksAcross } from '../../../../sdk-core/src/texture/previewLevels.ts'
import { PREVIEW_BLOCK_BYTES } from '../../../../sdk-core/src/texture/previewFormat.ts'

/**
 * THE BC CHAIN AS RGBA8, for a device that samples no BC block (`blockFormats.ts`): every cooked
 * level is stored once, in BC7 — or BC5 for a normal map —, and a pool of the lossless lane takes
 * it decoded here, texel for texel what the compiler's decoder reads (`blocks/decode.rs`), by the
 * specification's integer rules (BC7: the eight modes, their partitions and p-bits; BC5: two BC4
 * channels, Z rebuilt as the shader rebuilds it). The output is `blocksAcross(width) × 4` texels wide and as many high, rows packed:
 * whole blocks, as the record or level holds them, which a texture write crops to its region. It
 * runs in a page worker (`geometry/work/task.ts`, op `blocks`), off the main thread.
 */

/** Two-subset partitions, two bits a texel, texel 0 in the low bits (BC7 specification). */
const PARTITIONS_2 = [
  0x50505050, 0x40404040, 0x54545454, 0x54505040, 0x50404000, 0x55545450, 0x55545040, 0x54504000,
  0x50400000, 0x55555450, 0x55544000, 0x54400000, 0x55555440, 0x55550000, 0x55555500, 0x55000000,
  0x55150100, 0x4054, 0x15010000, 0x405054, 0x4050, 0x15050100, 0x5010000, 0x40505054, 0x404050,
  0x5010100, 0x14141414, 0x5141450, 0x1155440, 0x555500, 0x15014054, 0x5414150, 0x44444444,
  0x55005500, 0x11441144, 0x5055050, 0x5500550, 0x11114444, 0x41144114, 0x44111144, 0x15055054,
  0x1055040, 0x5041050, 0x5455150, 0x14414114, 0x50050550, 0x41411414, 0x141400, 0x41504, 0x105410,
  0x10541000, 0x4150400, 0x50410514, 0x41051450, 0x5415014, 0x14054150, 0x41050514, 0x41505014,
  0x40011554, 0x54150140, 0x50505500, 0x555050, 0x15151010, 0x54540404,
]
/** Three-subset partitions, same packing. */
const PARTITIONS_3 = [
  0xaa685050, 0x6a5a5040, 0x5a5a4200, 0x5450a0a8, 0xa5a50000, 0xa0a05050, 0x5555a0a0, 0x5a5a5050,
  0xaa550000, 0xaa555500, 0xaaaa5500, 0x90909090, 0x94949494, 0xa4a4a4a4, 0xa9a59450, 0x2a0a4250,
  0xa5945040, 0xa425054, 0xa5a5a500, 0x55a0a0a0, 0xa8a85454, 0x6a6a4040, 0xa4a45000, 0x1a1a0500,
  0x50a4a4, 0xaaa59090, 0x14696914, 0x69691400, 0xa08585a0, 0xaa821414, 0x50a4a450, 0x6a5a0200,
  0xa9a58000, 0x5090a0a8, 0xa8a09050, 0x24242424, 0xaa5500, 0x24924924, 0x24499224, 0x50a50a50,
  0x500aa550, 0xaaaa4444, 0x66660000, 0xa5a0a5a0, 0x50a050a0, 0x69286928, 0x44aaaa44, 0x66666600,
  0xaa444444, 0x54a854a8, 0x95809580, 0x96969600, 0xa85454a8, 0x80959580, 0xaa141414, 0x96960000,
  0xaaaa1414, 0xa05050a0, 0xa0a5a5a0, 0x96000000, 0x40804080, 0xa9a8a9a8, 0xaaaaaa44, 0x2a4a5254,
]
/** The second subset's anchor texel of each two-subset partition. */
const ANCHORS_2 = [
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2,
  2, 8, 8, 2, 2, 15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15,
  15, 15, 15, 15, 2, 2, 15,
]
/** The second and third subsets' anchor texels of each three-subset partition, lowest first. */
const ANCHORS_3 = [
  [3, 15],
  [3, 8],
  [8, 15],
  [3, 15],
  [8, 15],
  [3, 15],
  [3, 15],
  [8, 15],
  [8, 15],
  [8, 15],
  [6, 15],
  [6, 15],
  [6, 15],
  [5, 15],
  [3, 15],
  [3, 8],
  [3, 15],
  [3, 8],
  [8, 15],
  [3, 15],
  [3, 15],
  [3, 8],
  [6, 15],
  [8, 10],
  [3, 5],
  [8, 15],
  [6, 8],
  [6, 10],
  [8, 15],
  [5, 15],
  [10, 15],
  [8, 15],
  [8, 15],
  [3, 15],
  [3, 15],
  [5, 10],
  [6, 10],
  [8, 10],
  [8, 9],
  [10, 15],
  [6, 15],
  [3, 15],
  [8, 15],
  [5, 15],
  [3, 15],
  [6, 15],
  [6, 15],
  [8, 15],
  [3, 15],
  [3, 15],
  [5, 15],
  [5, 15],
  [5, 15],
  [8, 15],
  [5, 15],
  [10, 15],
  [5, 15],
  [10, 15],
  [8, 15],
  [13, 15],
  [3, 15],
  [12, 15],
  [3, 15],
  [3, 8],
]
/** Each texel's subset and whether it anchors it, per partition: `subset | anchor << 2`. */
const texelsOf = (partitions: number[], anchors: (number | number[])[]) =>
  partitions.map((word, p) => {
    const anchored = new Set([0, ...[anchors[p]].flat()])
    return Uint8Array.from(
      { length: 16 },
      (_, t) => ((word >>> (2 * t)) & 3) | (anchored.has(t) ? 4 : 0),
    )
  })
const SUBSETS: Uint8Array[][] = [
  [Uint8Array.from({ length: 16 }, (_, t) => (t === 0 ? 4 : 0))],
  texelsOf(PARTITIONS_2, ANCHORS_2),
  texelsOf(PARTITIONS_3, ANCHORS_3),
]

/** Interpolation weights over 64, by index bits. */
const WEIGHTS: readonly (readonly number[])[] = [
  [],
  [],
  [0, 21, 43, 64],
  [0, 9, 18, 27, 37, 46, 55, 64],
  [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64],
]

/** BC7 modes: subsets, partition bits, rotation bits, index-selection bit, colour and alpha bits,
 *  p-bits (per endpoint, or shared per subset), primary and secondary index bits. */
type Mode = {
  subsets: number
  partitionBits: number
  rotationBits: number
  selectionBits: number
  colourBits: number
  alphaBits: number
  endpointP: number
  sharedP: number
  indexBits: number
  index2Bits: number
}
const mode = (...v: number[]): Mode => ({
  subsets: v[0],
  partitionBits: v[1],
  rotationBits: v[2],
  selectionBits: v[3],
  colourBits: v[4],
  alphaBits: v[5],
  endpointP: v[6],
  sharedP: v[7],
  indexBits: v[8],
  index2Bits: v[9],
})
const MODES = [
  mode(3, 4, 0, 0, 4, 0, 1, 0, 3, 0),
  mode(2, 6, 0, 0, 6, 0, 0, 1, 3, 0),
  mode(3, 6, 0, 0, 5, 0, 0, 0, 2, 0),
  mode(2, 6, 0, 0, 7, 0, 1, 0, 2, 0),
  mode(1, 0, 2, 1, 5, 6, 0, 0, 2, 3),
  mode(1, 0, 2, 0, 7, 8, 0, 0, 2, 2),
  mode(1, 0, 0, 0, 7, 7, 1, 0, 4, 0),
  mode(2, 6, 0, 0, 5, 5, 1, 0, 2, 0),
]

/** The block being read, as four little-endian words, and the next bit's place: one block at a
 *  time, nothing allocated per block — a tile is a thousand of them. */
const words = new Uint32Array(4)
let bit = 0
/** The next `count` bits (at most 24) of the block, the first in the lowest. */
function read(count: number) {
  const word = bit >>> 5,
    shift = bit & 31
  let value = words[word] >>> shift
  if (shift + count > 32) value |= words[word + 1] << (32 - shift)
  bit += count
  return value & ((1 << count) - 1)
}
/** Each endpoint's four channels, then the primary and secondary indices of the block. */
const endpoints = new Uint8Array(6 * 4),
  index = new Uint8Array(16),
  index2 = new Uint8Array(16)

/** A `bits`-bit endpoint value widened to a byte by replicating its high bits. */
const widen = (value: number, bits: number) =>
  ((value << (8 - bits)) | (value >> (2 * bits - 8))) & 255
const mix = (e0: number, e1: number, w: number) => ((64 - w) * e0 + w * e1 + 32) >> 6

/** Loads the sixteen bytes at `offset` into the block words and rewinds the bit reader. */
function loadBlock(bytes: Uint8Array, offset: number) {
  for (let w = 0; w < 4; w++) {
    const o = offset + 4 * w
    words[w] = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)
  }
  bit = 0
}

/** Reads the block's endpoints into `endpoints`, p-bits applied and every channel widened to a byte. */
function readEndpoints(md: Mode, ends: number) {
  for (let c = 0; c < 3; c++)
    for (let e = 0; e < ends; e++) endpoints[e * 4 + c] = read(md.colourBits)
  for (let e = 0; e < ends; e++) endpoints[e * 4 + 3] = md.alphaBits ? read(md.alphaBits) : 255
  const p = md.endpointP || md.sharedP
  if (p) {
    // A p-bit per endpoint, or one a subset shared by its two: the low bit of every channel.
    let pBits = 0
    if (md.endpointP) for (let e = 0; e < ends; e++) pBits |= read(1) << e
    else for (let s = 0; s < md.subsets; s++) pBits |= read(1) * (3 << (2 * s))
    for (let e = 0; e < ends; e++)
      for (let c = 0; c < (md.alphaBits ? 4 : 3); c++)
        endpoints[e * 4 + c] = (endpoints[e * 4 + c] << 1) | ((pBits >> e) & 1)
  }
  for (let e = 0; e < ends; e++) {
    for (let c = 0; c < 3; c++)
      endpoints[e * 4 + c] = widen(endpoints[e * 4 + c], md.colourBits + p)
    if (md.alphaBits) endpoints[e * 4 + 3] = widen(endpoints[e * 4 + 3], md.alphaBits + p)
  }
}

/** Reads the primary and secondary indices of the block into `index` and `index2`. */
function readIndices(md: Mode, subsets: Uint8Array) {
  for (let t = 0; t < 16; t++) index[t] = read(md.indexBits - (subsets[t] >> 2))
  if (md.index2Bits)
    for (let t = 0; t < 16; t++) index2[t] = read(md.index2Bits - (t === 0 ? 1 : 0))
}

/** Interpolates the sixteen texels of the block from its endpoints and indices into `out[at]`. */
function writeTexels(
  md: Mode,
  subsets: Uint8Array,
  selection: number,
  rotation: number,
  out: Uint8Array,
  at: number,
  pitch: number,
) {
  // Mode 4's selection bit gives colour the secondary (three-bit) indices and alpha the primary.
  const swap = md.index2Bits && selection
  const colourIndex = swap ? index2 : index,
    alphaIndex = md.index2Bits && !selection ? index2 : index
  const colourWeights = WEIGHTS[swap ? md.index2Bits : md.indexBits],
    alphaWeights = WEIGHTS[md.index2Bits && !selection ? md.index2Bits : md.indexBits]
  for (let t = 0; t < 16; t++) {
    const e0 = (subsets[t] & 3) * 8,
      e1 = e0 + 4,
      i = at + (t >> 2) * pitch + (t & 3) * 4
    const wc = colourWeights[colourIndex[t]],
      wa = alphaWeights[alphaIndex[t]]
    for (let c = 0; c < 3; c++) out[i + c] = mix(endpoints[e0 + c], endpoints[e1 + c], wc)
    out[i + 3] = md.alphaBits ? mix(endpoints[e0 + 3], endpoints[e1 + 3], wa) : 255
    if (rotation) {
      const swapped = out[i + rotation - 1]
      out[i + rotation - 1] = out[i + 3]
      out[i + 3] = swapped
    }
  }
}

/** One BC7 block into the sixteen texels at `out[at]`, rows `pitch` bytes apart. */
function decodeBc7Block(
  bytes: Uint8Array,
  offset: number,
  out: Uint8Array,
  at: number,
  pitch: number,
) {
  loadBlock(bytes, offset)
  let m = 0
  while (m < 8 && read(1) === 0) m++
  if (m === 8) {
    // A reserved mode decodes to transparent black.
    for (let row = 0; row < 4; row++) out.fill(0, at + row * pitch, at + row * pitch + 16)
    return
  }
  const md = MODES[m]
  const partition = read(md.partitionBits)
  const rotation = read(md.rotationBits)
  const selection = read(md.selectionBits)
  readEndpoints(md, md.subsets * 2)
  const subsets = SUBSETS[md.subsets - 1][partition]
  readIndices(md, subsets)
  writeTexels(md, subsets, selection, rotation, out, at, pitch)
}

/** The eight values a BC4 block's codes name (`decodeBc4Channel`), one ramp every block fills. */
const ramp = new Uint8Array(8)

/** One BC4 channel of a block (eight bytes at `offset`) into channel `c` of the sixteen texels,
 *  `texel` bytes each (four in RGBA8, one in a one-channel surface). */
export function decodeBc4Channel(
  bytes: Uint8Array,
  offset: number,
  out: Uint8Array,
  at: number,
  pitch: number,
  c: number,
  texel = 4,
) {
  const r0 = bytes[offset],
    r1 = bytes[offset + 1]
  ramp[0] = r0
  ramp[1] = r1
  // Truncated, as the compiler's decoder reads it (`texture2ddecoder`): the gate measured that.
  if (r0 > r1) for (let i = 1; i < 7; i++) ramp[i + 1] = Math.floor(((7 - i) * r0 + i * r1) / 7)
  else {
    for (let i = 1; i < 5; i++) ramp[i + 1] = Math.floor(((5 - i) * r0 + i * r1) / 5)
    ramp[6] = 0
    ramp[7] = 255
  }
  for (let t = 0; t < 16; t++) {
    const bit = 16 + 3 * t
    const byte = offset + (bit >> 3),
      shift = bit & 7
    const code = ((bytes[byte] | (bytes[byte + 1] << 8)) >> shift) & 7
    out[at + (t >> 2) * pitch + (t & 3) * texel + c] = ramp[code]
  }
}

/** Z of a unit normal from its X and Y bytes, as the shader rebuilds it (`rebuilt_z`, `decode.rs`). */
function rebuiltZ(x: number, y: number) {
  const ux = x / 127.5 - 1,
    uy = y / 127.5 - 1
  // z within [0, 1]: the byte within [128, 255], no clamp needed.
  const z = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy))
  return Math.round((z + 1) * 127.5)
}

/** The RGBA8 texels of `blocks`, a `width` × `height` surface of BC7 blocks — or of BC5 ones when
 *  `twoChannel`, X in R, Y in G, Z rebuilt in B, opaque —, whole blocks, rows packed. */
export function decodeBcLevel(
  blocks: Uint8Array,
  width: number,
  height: number,
  twoChannel: boolean,
) {
  const across = blocksAcross(width),
    down = blocksAcross(height)
  if (blocks.byteLength !== across * down * PREVIEW_BLOCK_BYTES)
    throw new Error(`TEXTURE_BLOCK_BYTES ${width}x${height}: ${blocks.byteLength}`)
  const pitch = across * 16
  const out = new Uint8Array(pitch * down * 4)
  for (let by = 0; by < down; by++)
    for (let bx = 0; bx < across; bx++) {
      const offset = (by * across + bx) * PREVIEW_BLOCK_BYTES,
        at = by * 4 * pitch + bx * 16
      if (!twoChannel) {
        decodeBc7Block(blocks, offset, out, at, pitch)
        continue
      }
      decodeBc4Channel(blocks, offset, out, at, pitch, 0)
      decodeBc4Channel(blocks, offset + 8, out, at, pitch, 1)
      for (let t = 0; t < 16; t++) {
        const i = at + (t >> 2) * pitch + (t & 3) * 4
        out[i + 2] = rebuiltZ(out[i], out[i + 1])
        out[i + 3] = 255
      }
    }
  return out
}
