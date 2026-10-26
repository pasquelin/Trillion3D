import { EngineError } from '../contracts/cache.ts'
import { hexOfBytes } from '../../../math/src/scalar/hex.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import {
  VOLUMETRIC_LIGHTMAP_CELL_HEADER_WORDS,
  VOLUMETRIC_LIGHTMAP_CELL_RECORD_WORDS,
  VOLUMETRIC_LIGHTMAP_CELL_TEXELS,
  VOLUMETRIC_LIGHTMAP_FIRST_VERSION,
  VOLUMETRIC_LIGHTMAP_FIXED_WORDS,
  VOLUMETRIC_LIGHTMAP_HEADER_WORDS,
  VOLUMETRIC_LIGHTMAP_LAYERS,
  VOLUMETRIC_LIGHTMAP_LAYER_WORDS,
  VOLUMETRIC_LIGHTMAP_MAGIC,
  VOLUMETRIC_LIGHTMAP_MAX_LAYOUT,
  VOLUMETRIC_LIGHTMAP_VERSION,
} from '../contracts/writtenFormats.ts'

/**
 * The volumetric lightmap's file, as the compiler writes it
 * (`packages/asset-compiler-rust/src/volumetric_lightmap/`): precomputed indirect light in bricks.
 * An indirection volume, one texel a brick of the finest level, names a brick of the atlas and how
 * many finest bricks it spans; a brick holds `brickSize`³ samples of third-order spherical
 * harmonics and one row of padding, so the atlas is made of bricks `brickSize + 1` wide. The
 * samples are the ambient (the zeroth coefficient, a packed float colour), six layers of the
 * other coefficients — each divided by the ambient and its basis function's scale and mapped to
 * [0, 1] (`volumetricLightmap/sampleWgsl.ts` undoes it) —, the sky's bent normal, whose length is
 * the sky's visibility, and the stationary sun's shadowing, a layer the file keeps in its place
 * and checks but the engine reads nowhere (no light is stationary here). The head and the layers
 * are laid out in `volumetric_lightmap/format.rs`; the numbers come from `../contracts/writtenFormats.ts`.
 */

/** The three sides of a volume, in texels. */
type VolumeSize = readonly [number, number, number]

/** A texel format of the file, by its WebGPU name. */
export type VolumetricLightmapFormat = 'rgba8uint' | 'rg11b10ufloat' | 'rgba8unorm' | 'r8unorm'

/** A layer: its texels' format and bytes, a view into the file. */
export interface VolumetricLightmapLayer {
  readonly format: VolumetricLightmapFormat
  readonly bytes: Uint8Array
}

/** A streaming cell of the finest bricks: where it lies in the grid of cells, how many bricks it
 *  holds, where its bytes lie in the file and their SHA-256 (lowercase hexadecimal). */
export interface VolumetricLightmapCell {
  readonly coordinates: readonly [number, number, number]
  readonly bricks: number
  readonly offset: number
  readonly bytes: number
  readonly sha256: string
}

/** A cell's bricks as its bytes hold them, views into them: each brick's texel in the indirection
 *  volume, then each layer's padded texels, brick after brick. */
export interface VolumetricLightmapCellData {
  readonly positions: Uint32Array
  readonly ambient: Uint8Array
  readonly coefficients: readonly Uint8Array[]
  readonly skyBentNormal?: Uint8Array
  readonly directionalShadowing: Uint8Array
}

/** A volumetric lightmap as the file holds it. */
export interface VolumetricLightmapData {
  /** Texels along a brick's unique side. */
  readonly brickSize: number
  /** The world box the indirection volume covers, lower then upper corner. */
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
  /** The indirection volume's size in texels, and the atlas's. */
  readonly indirectionSize: VolumeSize
  readonly atlasSize: VolumeSize
  readonly indirection: VolumetricLightmapLayer
  readonly ambient: VolumetricLightmapLayer
  /** The six layers of coefficients: red, green, blue, each its low then its high half. */
  readonly coefficients: readonly VolumetricLightmapLayer[]
  /** The sky's bent normal, none where the sky is not shadowed. */
  readonly skyBentNormal?: VolumetricLightmapLayer
  /** The cells the finest bricks stream by, none where all the bricks are in the layers. `texels`
   *  is a cell's side in indirection texels. */
  readonly cells?: { readonly texels: number; readonly list: readonly VolumetricLightmapCell[] }
}

/** Texels along a padded brick of a lightmap of bricks `brickSize` texels a side: one row of padding. */
export const paddedBrickSide = (brickSize: number) => brickSize + 1

/** The bricks of an atlas along each side for `count` bricks, as the compiler lays them out: a row
 *  of at most `VOLUMETRIC_LIGHTMAP_MAX_LAYOUT`, then rows of them, then layers. */
export function layoutDimensions(count: number): VolumeSize {
  const x = Math.min(count, VOLUMETRIC_LIGHTMAP_MAX_LAYOUT)
  let left = ceilDiv(count, x)
  const y = Math.min(left, VOLUMETRIC_LIGHTMAP_MAX_LAYOUT)
  left = ceilDiv(left, y)
  return [x, y, Math.min(left, VOLUMETRIC_LIGHTMAP_MAX_LAYOUT)]
}

/** The rank of the brick at (`x`, `y`, `z`) of the atlas's layout, which an indirection texel names
 *  by its three bytes, and the place of rank `rank`. */
export const brickRank = (x: number, y: number, z: number) =>
  x + (y + z * VOLUMETRIC_LIGHTMAP_MAX_LAYOUT) * VOLUMETRIC_LIGHTMAP_MAX_LAYOUT
export const brickPlace = (rank: number): VolumeSize => [
  rank % VOLUMETRIC_LIGHTMAP_MAX_LAYOUT,
  Math.floor(rank / VOLUMETRIC_LIGHTMAP_MAX_LAYOUT) % VOLUMETRIC_LIGHTMAP_MAX_LAYOUT,
  Math.floor(rank / VOLUMETRIC_LIGHTMAP_MAX_LAYOUT ** 2),
]

/** The formats by the code the head holds, 1 to 4, and the code of each layer in file order. */
const VOLUMETRIC_LIGHTMAP_FORMATS = ['rgba8uint', 'rg11b10ufloat', 'rgba8unorm', 'r8unorm'] as const
const LAYER_FORMATS: readonly number[] = [1, 2, 3, 3, 3, 3, 3, 3, 3, 4]
const BYTES_PER_TEXEL = [4, 4, 4, 1]
const SKY_LAYER = 8
const WORD = 4

const refuse = (why: string): never => {
  throw new EngineError('INVALID_CACHE', `volumetric lightmap: ${why}`, {})
}

const texels = (size: VolumeSize) => size[0] * size[1] * size[2]

/** The sizes the head promises, checked: a brick, a whole number of padded bricks per side, a
 *  layout a byte names. */
function checkSizes(brickSize: number, indirection: VolumeSize, atlas: VolumeSize) {
  if (!(brickSize > 0) || indirection.some((s) => s === 0)) refuse('an empty volume')
  const padded = paddedBrickSide(brickSize)
  if (atlas.some((s) => s === 0 || s % padded !== 0 || s / padded > VOLUMETRIC_LIGHTMAP_MAX_LAYOUT))
    refuse('the atlas is not a layout of padded bricks')
}

/** The cells the table after the layers lists, from the word `at`. */
function readCells(bytes: Uint8Array, at: number, texels: number, count: number) {
  const record = VOLUMETRIC_LIGHTMAP_CELL_RECORD_WORDS * WORD
  if (at + count * record > bytes.byteLength) refuse('shorter than its cells')
  const words = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const list = Array.from({ length: count }, (_, k): VolumetricLightmapCell => {
    const first = at + k * record
    const word = (i: number) => words.getUint32(first + i * WORD, true)
    return {
      coordinates: [word(0), word(1), word(2)],
      bricks: word(3),
      offset: word(4),
      bytes: word(5),
      sha256: hexOfBytes(bytes.subarray(first + 6 * WORD, first + record)),
    }
  })
  return { texels, list }
}

/** The bricks a cell's `bytes` hold (`cell.bricks` of them), or throws `INVALID_CACHE`: the parts
 *  are views into `bytes`. `sky` is whether the file has a bent normal layer. */
export function parseVolumetricLightmapCell(
  bytes: Uint8Array,
  cell: VolumetricLightmapCell,
  sky: boolean,
): VolumetricLightmapCellData {
  const count = cell.bricks
  const texelsOf = (bytesPerTexel: number) =>
    count * VOLUMETRIC_LIGHTMAP_CELL_TEXELS * bytesPerTexel
  const wanted = count * 12 + texelsOf(4) * (sky ? 8 : 7) + texelsOf(1)
  if (bytes.byteLength < wanted) refuse('a cell shorter than its bricks')
  const positions = new Uint32Array(count * 3)
  new Uint8Array(positions.buffer).set(bytes.subarray(0, count * 12))
  let at = count * 12
  const take = (length: number) => bytes.subarray(at, (at += length))
  const ambient = take(texelsOf(4))
  const coefficients = Array.from({ length: 6 }, () => take(texelsOf(4)))
  const skyBentNormal = sky ? take(texelsOf(4)) : undefined
  return {
    positions,
    ambient,
    coefficients,
    skyBentNormal,
    directionalShadowing: take(texelsOf(1)),
  }
}

/** Reads the file `bytes` hold, or throws `INVALID_CACHE`; a file of another version throws
 *  `UNSUPPORTED_FORMAT`. The layers are views into `bytes`, which stay alive with them. A file
 *  of the second version may be given as its first `baseBytes` alone: its cells' bytes are read
 *  apart (`parseVolumetricLightmapCell`). */
export function parseVolumetricLightmap(bytes: Uint8Array): VolumetricLightmapData {
  if (bytes.byteLength < VOLUMETRIC_LIGHTMAP_HEADER_WORDS * WORD) refuse('shorter than its head')
  const words = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const word = (i: number) => words.getUint32(i * WORD, true)
  const real = (i: number) => words.getFloat32(i * WORD, true)
  if (word(0) !== VOLUMETRIC_LIGHTMAP_MAGIC) refuse('not a volumetric lightmap')
  const version = word(1)
  if (version < VOLUMETRIC_LIGHTMAP_FIRST_VERSION || version > VOLUMETRIC_LIGHTMAP_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `volumetric lightmap: version ${word(1)}, this engine reads ${VOLUMETRIC_LIGHTMAP_FIRST_VERSION} to ${VOLUMETRIC_LIGHTMAP_VERSION}`,
      {},
    )
  const triple = (at: number) => [word(at), word(at + 1), word(at + 2)] as const
  const brickSize = word(2)
  const indirectionSize = triple(9)
  const atlasSize = triple(12)
  checkSizes(brickSize, indirectionSize, atlasSize)
  const cellWords = version >= 2 ? VOLUMETRIC_LIGHTMAP_CELL_HEADER_WORDS : 0
  if (bytes.byteLength < (VOLUMETRIC_LIGHTMAP_HEADER_WORDS + cellWords) * WORD)
    refuse('shorter than its head')
  let offset = (VOLUMETRIC_LIGHTMAP_HEADER_WORDS + cellWords) * WORD
  const layers = Array.from({ length: VOLUMETRIC_LIGHTMAP_LAYERS }, (_, k) => {
    const entry = VOLUMETRIC_LIGHTMAP_FIXED_WORDS + k * VOLUMETRIC_LIGHTMAP_LAYER_WORDS
    const length = word(entry + 1)
    const code = LAYER_FORMATS[k]
    if (word(entry) !== code) refuse(`layer ${k} is not in format ${code}`)
    const wanted = texels(k === 0 ? indirectionSize : atlasSize) * BYTES_PER_TEXEL[code - 1]
    if (length !== wanted && !(k === SKY_LAYER && length === 0))
      refuse(`layer ${k} holds ${length} bytes, its volume needs ${wanted}`)
    if (offset + length > bytes.byteLength) refuse('shorter than its layers')
    const layer = {
      format: VOLUMETRIC_LIGHTMAP_FORMATS[code - 1],
      bytes: bytes.subarray(offset, offset + length),
    }
    offset += ceilDiv(length, WORD) * WORD
    return layer
  })
  const cellCount = cellWords ? word(VOLUMETRIC_LIGHTMAP_HEADER_WORDS + 1) : 0
  const cells = cellCount
    ? readCells(bytes, offset, word(VOLUMETRIC_LIGHTMAP_HEADER_WORDS), cellCount)
    : undefined
  return {
    brickSize,
    min: [real(3), real(4), real(5)],
    max: [real(6), real(7), real(8)],
    indirectionSize,
    atlasSize,
    indirection: layers[0],
    ambient: layers[1],
    coefficients: layers.slice(2, 8),
    skyBentNormal: layers[SKY_LAYER].bytes.byteLength ? layers[SKY_LAYER] : undefined,
    cells,
  }
}
