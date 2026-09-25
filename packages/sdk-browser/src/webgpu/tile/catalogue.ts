import type { Texture } from '../../../../sdk-core/src/index.ts';
import { previewIsWhole, type TexturePreview } from '../../../../sdk-core/src/index.ts';
import { previewAtlasOf } from '../../../../sdk-core/src/texture/previewFormat.ts';
import { WHITE_TAIL, type PoolEncoding } from '../../texture/blockFormats.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';
import { tileLayout } from '../../texture/tiles.ts';
import { sourceSize } from './live.ts';
import type { TileTexture } from './atlas.ts';

/**
 * Sidecar entries filed by the scene texture they cover and the atlas that samples them: the same
 * texture can have an entry for each, reduced by that atlas's curve. A coverage chain is its
 * texture's colour-atlas entry — that texture then has no plain one — and keeps its own word,
 * which names its files.
 */
export function previewsByAtlas(previews: readonly TexturePreview[]) {
  const filed = new Map<string, TexturePreview>();
  for (const preview of previews)
    filed.set(`${preview.texture}/${previewAtlasOf(preview.atlas)}`, preview);
  return (texture: number, atlas: number) => filed.get(`${texture}/${atlas}`);
}

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
 * white texel, what a material without a map reads. A hosted texture every reader of which takes
 * its alpha for coverage (`coverage`, the colour census's) reduces its mips weighted by alpha, as
 * the compiler bakes its chain.
 */
export function tileCatalogue(
  maps: readonly Texture[],
  previewFor: (index: number) => TexturePreview | undefined,
  readLevel: TextureLevelReader | undefined,
  encoding: PoolEncoding,
  coverage?: ReadonlyMap<Texture, boolean>,
): TileTexture[] {
  const textures = maps.map((map, index): TileTexture => {
    const preview = previewFor(index);
    const chain =
      preview && previewIsWhole(preview) && (preview.bakedLevels === 0 || readLevel)
        ? preview
        : undefined;
    if (chain) {
      const layout = tileLayout(chain.width, chain.height);
      if (chain.firstLevel !== layout.tail || chain.levels.length !== layout.last - layout.tail + 1)
        throw new Error('TEXTURE_PREVIEW_GEOMETRY');
      return {
        layout,
        texture: map,
        lane: encoding.laneOf(chain),
        source:
          layout.tail === 0
            ? { kind: 'bytes', tail: chain }
            : { kind: 'baked', sha256: chain.sha256, atlas: chain.atlas, tail: chain },
      };
    }
    const [width, height] = sourceSize(map);
    return {
      layout: tileLayout(width, height),
      texture: map,
      lane: 'lossless',
      source: { kind: 'host', map, coverage: coverage?.get(map) ?? false },
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
