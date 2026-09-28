import type { Texture } from '../../../../sdk-core/src/index.ts';
import { pictureSize } from '../../texture/pictureSize.ts';
import { textureRgba } from '../../visibility/types.ts';
import type { HostMaterials } from '../../host/resources.ts';
import type { WebglClusterTextures } from './textures.ts';
import { eachMap, type Material } from './materialMaps.ts';

/** Bytes a map holds on the context: its picture in RGBA, and a third more for its mip chain. */
const heldBytes = (width: number, height: number) => Math.ceil((width * height * 16) / 3);

/**
 * THE CENSUS UPLOADS THE MAPS AHEAD OF THE DRAWS (#840). A picture sent to WebGL2 is copied
 * through the context's transfer memory, and when the GPU is behind — a busy compositor holds the
 * GPU process on its present — the first new picture of a frame waits for it: a map uploaded at
 * the first draw that shows it held that frame 100–140 ms on sponza `rue`. So the census, at the
 * session's first draw, when the GPU has nothing to catch up on, uploads every map the declared
 * surfaces bind (`eachMap`, the draw's own walk: same textures, same keys), until the maps it
 * counts reach `budgetBytes` — the texture pool the session grants. What it leaves, or a surface
 * declared later, uploads at its first draw, as before. A map with no picture yet is left too.
 * Returns the bytes it counted.
 */
export function primeMaps(
  textures: Pick<WebglClusterTextures, 'bind'>,
  declared: Iterable<HostMaterials>,
  budgetBytes: number,
) {
  const materials = new Set<Material>(),
    counted = new Set<Texture>();
  let bytes = 0;
  for (const material of declared)
    for (const one of Array.isArray(material) ? material : [material])
      materials.add(one as Material);
  for (const material of materials)
    eachMap(material, (unit, _map, texture, srgb, fallback, reader) => {
      if (!texture || bytes >= budgetBytes) return;
      const rgba = textureRgba(texture);
      if (!rgba && !texture.image) return;
      textures.bind(unit, texture, srgb, fallback, reader);
      if (counted.has(texture)) return;
      counted.add(texture);
      const [width, height] = rgba ? [rgba.width, rgba.height] : pictureSize(texture.image);
      bytes += heldBytes(width, height);
    });
  return bytes;
}
