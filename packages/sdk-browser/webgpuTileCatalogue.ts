import type { Texture } from '../sdk-core/index.ts';
import { previewIsWhole, type TexturePreview } from '../sdk-core/index.ts';
import { WHITE_TAIL, type PoolEncoding } from './textureBlockFormats.ts';
import { textureRgba } from './visibilityBuffer.ts';
import type { TextureLevelReader } from './textureLevelReader.ts';
import { tileLayout } from './textureTiles.ts';
import type { TileTexture } from './webgpuTileAtlas.ts';

/**
 * Catalogue of an atlas: one entry per source texture, at its slot, with its dimensions, the
 * lane its pool is, and the source of its texels. A whole cooked chain is enough — its
 * dimensions are the manifest's, its queue is in the sidecar in every encoding the gate kept,
 * its streamed levels are read in the cache — and the source image is not read; it takes the
 * lane of its layout in the session's family, the lossless one where the gate refused it. The
 * reader comes with the cache and not with an option, so a whole chain wins whatever the host
 * asked of the loader and no level the compiler baked is regenerated. The host texture is the
 * source only where the cache carries no whole chain — an image the cook skipped, texels the
 * page itself built — or on a runtime with no `createImageBitmap` to read a level with, where
 * the loader opens the source images for that very reason (`resolveTextureSource`), so the
 * texture has one; then in the lossless lane, the only one a host image can fill. Slot 0 is a
 * white texel, what a material without a map reads.
 */
export function tileCatalogue(
  maps: readonly Texture[],
  previewFor: (index: number) => TexturePreview | undefined,
  readLevel: TextureLevelReader | undefined,
  encoding: PoolEncoding,
): TileTexture[] {
  const textures = maps.map((map, index): TileTexture => {
    const preview = previewFor(index);
    const chain =
      preview && previewIsWhole(preview) && (preview.bakedLevels === 0 || readLevel)
        ? preview
        : undefined;
    const rgba = textureRgba(map);
    if (chain) {
      const layout = tileLayout(chain.width, chain.height);
      if (chain.firstLevel !== layout.tail || chain.levels.length !== layout.last - layout.tail + 1)
        throw new Error('TEXTURE_PREVIEW_GEOMETRY');
      return {
        layout,
        lane: encoding.laneOf(chain),
        source:
          layout.tail === 0
            ? { kind: 'bytes', tail: chain }
            : { kind: 'baked', sha256: chain.sha256, atlas: chain.atlas, tail: chain },
      };
    }
    const image = map.image as { width?: number; height?: number } | undefined;
    const width = rgba?.width ?? Math.max(1, image?.width ?? 1),
      height = rgba?.height ?? Math.max(1, image?.height ?? 1);
    return {
      layout: tileLayout(width, height),
      lane: 'lossless',
      source: { kind: 'host', map, rgba },
    };
  });
  // The fill takes a lane the textures already open, so its one texel costs no layer of its
  // own: the family's RGBA lane when a chain is kept there, else any lane that is open — the
  // lossless one of a host-image scene, the two-channel one of an atlas of normal maps —, and
  // the cheaper block lane only when the atlas has no texture at all.
  const open = new Set(textures.map((texture) => texture.lane));
  const fill: TileTexture = {
    layout: tileLayout(1, 1),
    lane: open.has(encoding.fillLane)
      ? encoding.fillLane
      : (open.values().next().value ?? encoding.fillLane),
    source: { kind: 'bytes', tail: WHITE_TAIL },
  };
  return [fill, ...textures];
}
