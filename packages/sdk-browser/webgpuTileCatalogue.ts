import type * as THREE from 'three';
import { previewIsWhole, type TexturePreview } from '../sdk-core/index.ts';
import { textureRgba } from './visibilityBuffer.ts';
import type { TextureLevelReader } from './textureLevelReader.ts';
import { tileLayout } from './textureTiles.ts';
import type { TileTexture } from './webgpuTileAtlas.ts';

/** Le slot 0 de chaque atlas : un texel blanc, ce qu'un matériau sans carte lit. */
const WHITE = new Uint8Array([255, 255, 255, 255]);

/**
 * Le catalogue d'un atlas : une entrée par texture source, à son slot, avec ses dimensions et la
 * source de ses texels. Une chaîne cuite entière se suffit — ses dimensions sont celles du
 * manifeste, sa queue est dans le sidecar, ses niveaux diffusés se lisent dans le cache — et l'image
 * source n'est pas lue. Sans chaîne cuite, ou sans lecteur, la texture de l'hôte est la source.
 */
export function tileCatalogue(
  maps: readonly THREE.Texture[],
  previewFor: (index: number) => TexturePreview | undefined,
  readLevel: TextureLevelReader | undefined,
): TileTexture[] {
  const fill: TileTexture = { layout: tileLayout(1, 1), source: { kind: 'bytes', tail: [WHITE] } };
  return [
    fill,
    ...maps.map((map, index): TileTexture => {
      const preview = previewFor(index);
      const chain =
        preview && previewIsWhole(preview) && (preview.bakedLevels === 0 || readLevel)
          ? preview
          : undefined;
      const rgba = textureRgba(map);
      if (chain) {
        const layout = tileLayout(chain.width, chain.height);
        if (
          chain.firstLevel !== layout.tail ||
          chain.levels.length !== layout.last - layout.tail + 1
        )
          throw new Error('TEXTURE_PREVIEW_GEOMETRY');
        const tail = chain.levels;
        return {
          layout,
          source:
            layout.tail === 0
              ? { kind: 'bytes', tail }
              : { kind: 'baked', sha256: chain.sha256, atlas: chain.atlas, tail },
        };
      }
      const image = map.image as { width?: number; height?: number } | undefined;
      const width = rgba?.width ?? Math.max(1, image?.width ?? 1),
        height = rgba?.height ?? Math.max(1, image?.height ?? 1);
      return { layout: tileLayout(width, height), source: { kind: 'host', map, rgba } };
    }),
  ];
}
