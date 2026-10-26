import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import type { TileLayout } from '../texture/tiles.ts'
import type { ChainLayouts, PoolLane, TailBytes } from '../texture/blockFormats.ts'
import type { TextureLevelReader } from '../texture/levelReader.ts'

/**
 * Where a texture's texels come from. `bytes`: everything fits in the sidecar tail, nothing is
 * streamed. `baked`: the tail comes from the sidecar, streamed levels are read cooked from the
 * cache whose scene built the texture, by that cache's reader, in the files its layouts name.
 * `host`: neither, the host image goes through a working texture whose mips the GPU builds. A
 * tail holds every encoding; the atlas pins its lane's.
 */
type TileSource =
  | { kind: 'bytes'; tail: TailBytes }
  | {
      kind: 'baked'
      sha256: string
      atlas: number
      tail: TailBytes & ChainLayouts
      read: TextureLevelReader
    }
  | { kind: 'host'; map: Texture }

/** A texture of the atlas: tile geometry, pool lane, texels, and its record — none for the fill. */
export type TileTexture = {
  retired?: boolean
  layout: TileLayout
  lane: PoolLane
  /** What the shader reads of its lane's pool (`PoolEncoding.tapOf`): its header's tap. */
  tap: number
  source: TileSource
  texture?: Texture
}
