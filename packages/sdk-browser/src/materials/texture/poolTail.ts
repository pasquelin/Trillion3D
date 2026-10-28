import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
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

/** The tail of the channel pool (`two-channel` with a one-channel content) once `tailSource` chose
 *  `source`: the R8 and float pools take the channel of the RGBA8 tail (grey and displacement chains
 *  hold it in R there), a chain kept in floats its exact squares. */
function channelTail(
  source: Exclude<TailSource, 'blocks' | 'white'>,
  channelPool: Exclude<ChannelPool, 'two' | 'bc4'>,
  tail: TailBytes & Partial<ChainLayouts>,
  geometry: { width: number; height: number; tail: number },
): readonly Uint8Array[] {
  const floatKind = channelPool === 'r32' ? 'r32' : 'r16'
  if (source === 'exact')
    return exactTail(
      tail,
      geometry,
      tail.layouts?.[PREVIEW_STORED_FORMAT] === 'single-float' ? 'r32f' : 'r16f',
      floatKind,
    )
  const reds = tail.levels.map(redOf)
  return channelPool === 'r8' ? reds : reds.map((red) => convertTexels(red, 'r8', channelPool))
}

/** Where a lane's tail is read from: the RGBA8 `levels`, the pool's block `blocks`, a chain's
 *  `exact` float squares, or the `white` fill of a BC4 pool with no one-channel chain. */
type TailSource = 'levels' | 'blocks' | 'exact' | 'white'

/** The source `poolTail` reads for `lane`: one decision, shared with `tailReadsLevels`. */
function tailSource(
  { block, hdrBlocks, channelPool, hdr32 }: PoolSettings,
  tail: Partial<ChainLayouts>,
  lane: PoolLane,
): TailSource {
  const kept = tail.layouts?.[PREVIEW_STORED_FORMAT]
  if (lane === 'hdr') {
    if (kept === 'float32') return 'exact'
    return !hdr32 && hdrBlocks && block ? 'blocks' : 'levels'
  }
  if (lane === 'two-channel' && channelPool !== 'two') {
    if (kept === 'single-float' || kept === 'half-single') return 'exact'
    if (channelPool === 'bc4') return kept === 'one-channel' && block ? 'blocks' : 'white'
    return 'levels'
  }
  return lane === 'lossless' || !block ? 'levels' : 'blocks'
}

/** Whether `poolTail` takes `tail.levels` — the RGBA8 tail — for `lane`: the half-float lane's texels
 *  when unpacked from them or when its pool is not BC6H blocks (a `float32` chain has its own), the
 *  channel pool's R8 and float texels (not BC4, not a chain kept in floats), the lossless lane or a
 *  session without blocks. A cache keeping them in their own file loads them only where this holds. */
export function tailReadsLevels(
  settings: PoolSettings,
  tail: Partial<ChainLayouts>,
  lane: PoolLane,
): boolean {
  return tailSource(settings, tail, lane) === 'levels'
}

/** Which of a tail's encodings a lane's pool pins, unpacked into the pool's kind where it is floats.
 *  `geometry` is the texture's size and first carried level. */
export function poolTail(
  settings: PoolSettings,
  tail: TailBytes & Partial<ChainLayouts>,
  lane: PoolLane,
  geometry: { width: number; height: number; tail: number },
): readonly Uint8Array[] {
  const { block, channelPool, hdr32 } = settings
  const source = tailSource(settings, tail, lane)
  if (source === 'white') return [WHITE_BC4]
  if (source === 'blocks') return tail.blocks[block!]
  // A tail whose pixels lie in their own file is read only once loaded (`TextureCaches.ensureLevels`).
  if (source === 'levels' && tail.levels.some((level) => !level.length))
    throw new EngineError('INVALID_CACHE', "a texture preview's pixels were not loaded", {})
  if (lane === 'hdr') {
    if (source === 'exact') return exactTail(tail, geometry, 'rgba32f', hdr32 ? 'rgba32' : 'rgba16')
    return hdr32
      ? tail.levels.map((level) => convertTexels(level, 'rgba16', 'rgba32'))
      : tail.levels
  }
  if (lane === 'two-channel' && channelPool !== 'two')
    return channelTail(source, channelPool as Exclude<ChannelPool, 'two' | 'bc4'>, tail, geometry)
  return tail.levels
}
