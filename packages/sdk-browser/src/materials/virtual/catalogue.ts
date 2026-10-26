import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { previewIsWhole } from '../../../../sdk-core/src/texture/previewLevels.ts'
import type { PoolEncoding } from '../texture/blockFormats.ts'
import type { BakedChain } from '../texture/textureCaches.ts'
import { tileLayout } from '../texture/tiles.ts'
import { sourceSize } from '../texture/pictureSize.ts'
import type { TileTexture } from './tileTexture.ts'

/**
 * Catalogue of an atlas: one entry per source texture, at its slot, with its dimensions, the
 * lane its pool is, and the source of its texels. A whole cooked chain is enough — its
 * dimensions are the manifest's, its queue is in the sidecar in every encoding the gate kept,
 * its streamed levels are read in the cache whose scene built the texture, by that cache's reader
 * (`chainFor`, `materials/texture/textureCaches.ts`) — and the source image is not read; it takes the lane
 * of its layout in the session's family, the lossless one where the gate refused it. The reader
 * comes with the cache and not with an option, so a whole chain wins whatever the host asked of
 * the loader and no level the compiler baked is regenerated. The host texture is the
 * source only where the cache carries no whole chain — an image the cook skipped, texels the
 * page itself built —; then in the lossless lane, the only one a host image can fill. Slot 0 is a
 * white texel, what a material without a map reads.
 */
export function tileCatalogue(
  maps: readonly Texture[],
  chainFor: (index: number) => BakedChain | undefined,
  encoding: PoolEncoding,
): TileTexture[] {
  const textures = maps.map((map, index): TileTexture => {
    const found = chainFor(index)
    const read = found?.read
    const chain =
      found && previewIsWhole(found.preview) && (found.preview.bakedLevels === 0 || read)
        ? found.preview
        : undefined
    if (chain) {
      const layout = tileLayout(chain.width, chain.height)
      if (chain.firstLevel !== layout.tail || chain.levels.length !== layout.last - layout.tail + 1)
        throw new Error('TEXTURE_PREVIEW_GEOMETRY')
      return {
        layout,
        texture: map,
        lane: encoding.laneOf(chain),
        tap: encoding.tapOf(
          encoding.laneOf(chain),
          encoding.block && chain.layouts[encoding.block],
        ),
        // Levels past the tail of a whole chain are filed: its cache's reader is there.
        source:
          layout.tail === 0 || !read
            ? { kind: 'bytes', tail: chain }
            : { kind: 'baked', sha256: chain.sha256, atlas: chain.atlas, tail: chain, read },
      }
    }
    const [width, height] = sourceSize(map)
    return {
      layout: tileLayout(width, height),
      texture: map,
      lane: 'lossless',
      tap: encoding.tapOf('lossless'),
      source: { kind: 'host', map },
    }
  })
  // The fill takes a lane the textures already open, so its one texel costs no layer of its
  // own: the family's RGBA lane when a chain is kept there, else any lane that is open — the
  // lossless one of a host-image scene, the two-channel one of an atlas of normal maps —, and
  // the cheaper block lane only when the atlas has no texture at all.
  const open = new Set(textures.map((texture) => texture.lane))
  const fillIn = open.has(encoding.fillLane)
    ? encoding.fillLane
    : (open.values().next().value ?? encoding.fillLane)
  const fill: TileTexture = {
    layout: tileLayout(1, 1),
    lane: fillIn,
    tap: encoding.tapOf(fillIn),
    source: { kind: 'bytes', tail: encoding.whiteOf(fillIn) },
  }
  return [fill, ...textures]
}
