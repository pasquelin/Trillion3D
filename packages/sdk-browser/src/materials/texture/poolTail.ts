import { PREVIEW_STORED_FORMAT } from '../../../../sdk-core/src/texture/previewFormat.ts'
import { previewLevelSize } from '../../../../sdk-core/src/texture/previewLevels.ts'
import { convertTexels, cropTexels, decodeFloatLevel, type TexelKind } from './floatTexels.ts'
import type {
  ChainLayouts,
  ChannelPool,
  PoolLane,
  PoolSettings,
  TailBytes,
} from './blockFormats.ts'

/** One white texel in BC4: both endpoints at 255, every index 0. */
export const WHITE_BC4 = new Uint8Array([255, 255, 0, 0, 0, 0, 0, 0]) as Uint8Array<ArrayBuffer>

/** The red channel of an RGBA8 level, one byte a texel. */
const redOf = (rgba: Uint8Array) => rgba.filter((_, at) => at % 4 === 0)

/** A float chain's exact tail: its squares unpacked into the pool's kind, cropped to the level. */
function exactTail(
  tail: TailBytes,
  geometry: { width: number; height: number; tail: number },
  file: 'rgba32f' | 'r32f' | 'r16f',
  kind: TexelKind,
) {
  return tail.blocks[PREVIEW_STORED_FORMAT].map((blocks, rank) => {
    const [w, h] = previewLevelSize(geometry.width, geometry.height, geometry.tail + rank)
    return cropTexels(decodeFloatLevel(blocks, w, h, file, kind), w, h, kind)
  })
}

/** The tail of the channel pool (`two-channel` with a one-channel content). */
function channelTail(
  block: PoolSettings['block'],
  channelPool: Exclude<ChannelPool, 'two'>,
  tail: TailBytes & Partial<ChainLayouts>,
  geometry: { width: number; height: number; tail: number },
): readonly Uint8Array[] {
  const kept = tail.layouts?.[PREVIEW_STORED_FORMAT]
  const floatKind = channelPool === 'r32' ? 'r32' : 'r16'
  if (kept === 'single-float') return exactTail(tail, geometry, 'r32f', floatKind)
  if (kept === 'half-single') return exactTail(tail, geometry, 'r16f', floatKind)
  // The R8 and float pools take the channel of the RGBA8 tail (grey and displacement chains
  // hold it in R there); the BC4 pool the chain's own blocks, or white for the fill.
  if (channelPool === 'bc4')
    return kept === 'one-channel' && block ? tail.blocks[block] : [WHITE_BC4]
  const reds = tail.levels.map(redOf)
  return channelPool === 'r8' ? reds : reds.map((red) => convertTexels(red, 'r8', channelPool))
}

/** Which of a tail's encodings a lane's pool pins, unpacked into the pool's kind where it is floats.
 *  `geometry` is the texture's size and first carried level. */
export function poolTail(
  settings: PoolSettings,
  tail: TailBytes & Partial<ChainLayouts>,
  lane: PoolLane,
  geometry: { width: number; height: number; tail: number },
): readonly Uint8Array[] {
  const { block, hdrBlocks, channelPool, hdr32 } = settings
  if (lane === 'hdr') {
    if (tail.layouts?.[PREVIEW_STORED_FORMAT] === 'float32')
      return exactTail(tail, geometry, 'rgba32f', hdr32 ? 'rgba32' : 'rgba16')
    if (hdr32) return tail.levels.map((level) => convertTexels(level, 'rgba16', 'rgba32'))
    return hdrBlocks && block ? tail.blocks[block] : tail.levels
  }
  if (lane === 'two-channel' && channelPool !== 'two')
    return channelTail(block, channelPool, tail, geometry)
  if (lane === 'lossless' || !block) return tail.levels
  return tail.blocks[block]
}
