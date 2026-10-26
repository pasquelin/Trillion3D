import { fromHalf, toHalf } from '../../../../math/src/float/half.ts'
import { HALF_MAX } from '../../../../math/src/constants.ts'
import { fromUnorm8, unorm8 } from '../../../../math/src/color/color.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { blocksAcross } from '../../../../sdk-core/src/texture/previewLevels.ts'

/**
 * THE TEXELS OF THE FLOAT POOLS, read and written in each other's kinds: a float chain's level
 * files hold 4 × 4 squares of exact texels (`rgba32f`, `r32f`, `r16f`; the compiler's
 * `blocks/texels.rs`), and the pool that holds them is the scene's choice — 32 bits a channel where
 * the device filters them, else 16 — so a level is read in the pool's kind whatever its file's. A
 * kind is the channels a texel has and how a channel is stored: `r8` and `rgba8` are normalised
 * bytes, the others floats. Running in a page worker or on the tail, beside the block decoders.
 */
export type TexelKind = 'r8' | 'r16' | 'r32' | 'rgba8' | 'rgba16' | 'rgba32'

/** The channels of a texel of each kind and the bytes of one channel. */
const KINDS: Record<TexelKind, { channels: number; bytes: number }> = {
  r8: { channels: 1, bytes: 1 },
  r16: { channels: 1, bytes: 2 },
  r32: { channels: 1, bytes: 4 },
  rgba8: { channels: 4, bytes: 1 },
  rgba16: { channels: 4, bytes: 2 },
  rgba32: { channels: 4, bytes: 4 },
}
/** Bytes of one texel of each kind. */
export const TEXEL_BYTES = Object.fromEntries(
  Object.entries(KINDS).map(([kind, { channels, bytes }]) => [kind, channels * bytes]),
) as Record<TexelKind, number>
/** The kind a float level file holds, by its format. */
export const FILE_TEXELS = { rgba32f: 'rgba32', r32f: 'r32', r16f: 'r16' } as const

/** The channel values of `texels` of `kind`: bytes over 255, halves widened, floats as they are. */
function valuesOf(texels: Uint8Array, kind: TexelKind) {
  const count = texels.byteLength / KINDS[kind].bytes
  const view = new DataView(texels.buffer, texels.byteOffset, texels.byteLength)
  return Float32Array.from({ length: count }, (_, at) =>
    kind === 'r8' || kind === 'rgba8'
      ? fromUnorm8(texels[at])
      : kind === 'r16' || kind === 'rgba16'
        ? fromHalf(view.getUint16(at * 2, true))
        : view.getFloat32(at * 4, true),
  )
}

/** The texels of `kind` holding `values`, a channel each: a byte clamps to 0..1, a half to its
 *  range, a NaN reads as zero. */
function texelsOf(values: Float32Array, kind: TexelKind) {
  const { bytes } = KINDS[kind]
  const out = new Uint8Array(values.length * bytes)
  const view = new DataView(out.buffer)
  values.forEach((raw, at) => {
    const value = Number.isNaN(raw) ? 0 : raw
    if (bytes === 1) out[at] = unorm8(value)
    else if (bytes === 2) view.setUint16(at * 2, toHalf(clamp(value, -HALF_MAX, HALF_MAX)), true)
    else view.setFloat32(at * 4, value, true)
  })
  return out
}

/** `texels` of kind `from` as kind `to`: a one-channel texel widened to grey and opaque, a four-channel
 *  one narrowed to its red. */
export function convertTexels(texels: Uint8Array, from: TexelKind, to: TexelKind) {
  if (from === to) return texels
  const values = valuesOf(texels, from)
  if (KINDS[from].channels === KINDS[to].channels) return texelsOf(values, to)
  if (KINDS[to].channels === 1)
    return texelsOf(
      values.filter((_, at) => at % 4 === 0),
      to,
    )
  const wide = new Float32Array(values.length * 4)
  values.forEach((value, at) => wide.set([value, value, value, 1], at * 4))
  return texelsOf(wide, to)
}

/** The rows of a `width` × `height` level from its 4 × 4 squares of `kind` texels, each square row
 *  by row: whole blocks wide, rows packed, as the pools take a tile's region. */
export function unblockTexels(blocks: Uint8Array, width: number, height: number, kind: TexelKind) {
  const across = blocksAcross(width),
    down = blocksAcross(height),
    bytes = TEXEL_BYTES[kind]
  if (blocks.byteLength !== across * down * 16 * bytes)
    throw new Error(`TEXTURE_BLOCK_BYTES ${width}x${height}: ${blocks.byteLength}`)
  const pitch = across * 4 * bytes
  const out = new Uint8Array(pitch * down * 4)
  for (let by = 0; by < down; by++)
    for (let bx = 0; bx < across; bx++)
      for (let row = 0; row < 4; row++)
        out.set(
          blocks.subarray(
            ((by * across + bx) * 16 + row * 4) * bytes,
            ((by * across + bx) * 16 + row * 4 + 4) * bytes,
          ),
          (by * 4 + row) * pitch + bx * 4 * bytes,
        )
  return out
}

/** The `width` × `height` texels of `kind` a whole-block-wide `level` holds, rows packed. */
export function cropTexels(level: Uint8Array, width: number, height: number, kind: TexelKind) {
  const bytes = TEXEL_BYTES[kind],
    pitch = blocksAcross(width) * 4 * bytes
  if (pitch === width * bytes) return level.subarray(0, width * height * bytes)
  const out = new Uint8Array(width * height * bytes)
  for (let y = 0; y < height; y++)
    out.set(level.subarray(y * pitch, y * pitch + width * bytes), y * width * bytes)
  return out
}

/** A float level file's squares unpacked into `to` texels, whole blocks wide. */
export function decodeFloatLevel(
  blocks: Uint8Array,
  width: number,
  height: number,
  file: keyof typeof FILE_TEXELS,
  to: TexelKind,
) {
  const from = FILE_TEXELS[file]
  return convertTexels(unblockTexels(blocks, width, height, from), from, to)
}
