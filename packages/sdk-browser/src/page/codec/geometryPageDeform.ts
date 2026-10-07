import {
  CLUSTER_HEADER_WORDS,
  FLAG_MORPH,
  FLAG_SKIN,
  FLAG_SOFT_SOURCE,
  MAX_JOINT_BITS,
  MAX_MORPH_TARGETS,
  MORPH_WORDS,
} from '../../cluster/format.ts'
import type { Quant } from './geometryPageHeader.ts'
import { field } from '../../../../page-codec/src/bits.ts'

/**
 * What a `WGP3` page carries for the GPU deformation stage, the mirror of the shared
 * codec's `deform.rs`: word 23, the skin record — the page's smallest joint and the width of each
 * joint's distance to it — and the morph target count, then each target's nine words after the
 * header — the word its streams start at, then its position and normal records.
 */
export type PageSkin = { base: number; bits: number; influences: number }
export type PageMorph = { start: number; position: Quant; normal: Quant }

/** The skin and morph records of a page whose flags are `flags`, read from `head`; a word set
 *  that the flags do not announce, a record outside the format or past the bytes refuses it. */
export function readDeformation(head: DataView, flags: number) {
  const w = (i: number) => head.getUint32(i * 4, true),
    f = (i: number) => head.getFloat32(i * 4, true)
  // Word 23: the joint width in bits 0 to 5, the target count in 6 to 13, the smallest joint in
  // 14 to 29 (`deform.rs`, `word`).
  const word = w(23),
    skin: PageSkin = { bits: word & 63, base: (word >>> 14) & 0xffff, influences: w(24) },
    count = (word >>> 6) & 255
  const sane =
    (skin.bits | (count << 6) | (skin.base << 14)) >>> 0 === word &&
    (!!(flags & FLAG_SKIN) || (!skin.bits && !skin.base && !skin.influences)) &&
    (!(flags & FLAG_SOFT_SOURCE) || !!(flags & FLAG_SKIN)) &&
    (!(flags & FLAG_SKIN) || (skin.influences > 0 && skin.influences <= 65536)) &&
    skin.bits <= MAX_JOINT_BITS &&
    skin.base + 2 ** skin.bits - 1 <= 0xffff &&
    !!(flags & FLAG_MORPH) === count > 0 &&
    count <= MAX_MORPH_TARGETS
  if (!sane) throw new Error('GEOMETRY_PAGE_BOUNDS')
  if (head.byteLength < (CLUSTER_HEADER_WORDS + count * MORPH_WORDS) * 4)
    throw new Error('GEOMETRY_PAGE_BOUNDS')
  const morphs: PageMorph[] = []
  for (let t = 0; t < count; t++) {
    const at = CLUSTER_HEADER_WORDS + t * MORPH_WORDS
    const raw = (word: number): Quant => {
      if (
        w(word) !== (32 | (32 << 6) | (32 << 12)) ||
        [f(word + 1), f(word + 2), f(word + 3)].some((x) => x !== 0)
      )
        throw new Error('GEOMETRY_PAGE_BOUNDS')
      return { min: [0, 0, 0], exponent: 0, bits: [32, 32, 32] }
    }
    const position = raw(at + 1),
      normal = raw(at + 5)
    morphs.push({ start: w(at), position, normal })
  }
  return { skin, morphs }
}

/** Words of `count` fields of `bits` bits. */
const words = (count: number, bits: number) => Math.ceil((count * bits) / 32)

/** Words of every skin stream and of one target's six float32 streams. */
export const skinWords = (skin: PageSkin, n: number) => skin.influences * (words(n, skin.bits) + n)
export const morphWords = (morph: PageMorph, n: number) =>
  [...morph.position.bits, ...morph.normal.bits].reduce((sum, b) => sum + words(n, b), 0)

/** Each vertex's joints, then its weights, from the skin's streams at word `start`. */
export function decodeSkin(
  body: Uint32Array,
  start: number,
  skin: PageSkin,
  joints: Float32Array,
  weights: Float32Array,
) {
  const width = skin.influences,
    n = joints.length / width,
    jointWords = words(n, skin.bits),
    weightStart = start + width * jointWords
  const floats = new Float32Array(body.buffer, body.byteOffset, body.length)
  for (let v = 0; v < n; v++)
    for (let j = 0; j < width; j++) {
      joints[v * width + j] =
        skin.base + field(body, (start + j * jointWords) * 32 + v * skin.bits, skin.bits)
      weights[v * width + j] = floats[weightStart + j * n + v]
    }
}

/** Every target's displacement, six floats a target per vertex — position then normal. */
export function decodeMorphs(body: Uint32Array, morphs: readonly PageMorph[], out: Float32Array) {
  const width = 6 * morphs.length,
    n = out.length / width
  const floats = new Float32Array(body.buffer, body.byteOffset, body.length)
  morphs.forEach((morph, t) => {
    for (let c = 0; c < 6; c++)
      for (let v = 0; v < n; v++) out[v * width + t * 6 + c] = floats[morph.start + c * n + v]
  })
}

/** Reject corrupt float streams before GPU admission as well as before CPU decoding. */
export function validateRawDeformation(
  head: DataView,
  headerWords: number,
  vertexCount: number,
  flags: number,
  skinned: number,
  skin: PageSkin,
  morphs: readonly PageMorph[],
) {
  const raw = (start: number, count: number, weights: boolean) => {
    for (let i = 0; i < count; i++) {
      const value = head.getFloat32((headerWords + start + i) * 4, true)
      if (!Number.isFinite(value) || (weights && value < 0)) throw new Error('GEOMETRY_PAGE_BOUNDS')
    }
  }
  if (flags & FLAG_SKIN)
    raw(
      skinned + skin.influences * words(vertexCount, skin.bits),
      skin.influences * vertexCount,
      true,
    )
  for (const morph of morphs) raw(morph.start, vertexCount * 6, false)
}
