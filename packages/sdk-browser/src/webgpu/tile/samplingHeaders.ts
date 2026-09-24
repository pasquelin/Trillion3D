import type { Texture } from '../../../../sdk-core/src/index.ts';
import { watchTextureRevisions } from '../../host/textureRevisions.ts';
import type { WebgpuTileAtlas } from './atlas.ts';

/** Writes the headers of an atlas: all of them, or those of the records named. */
function atlasSampling({ pages, textures }: WebgpuTileAtlas) {
  const slots = new Map<Texture, number>();
  textures.forEach(({ texture }, slot) => texture && slots.set(texture, slot));
  const write = (slot: number) =>
    pages.setSampling(slot, textures[slot].texture!, textures[slot].source.kind !== 'host');
  return {
    all() {
      for (const slot of slots.values()) write(slot);
    },
    revised(records: ReadonlySet<Texture>, moved?: Set<number>) {
      let any = false;
      for (const record of records) {
        const slot = slots.get(record);
        if (slot === undefined || !write(slot)) continue;
        any = true;
        moved?.add(slot);
      }
      return any;
    },
  };
}

/**
 * Follows the sampling of the textures of a colour and a data atlas — filters, anisotropy, UV
 * transform — into their page-table headers (#360, #361), per texture and not per surface:
 * however many surfaces and passes read a texture, its header is written once per revision of its
 * record. `all` writes every header, at preparation. `revised` writes those of the records the
 * import named since its last call (`watchTextureRevisions`, `../../host/surfaceImport.ts`) and
 * only those, puts the colour slots whose words moved in `colourMoved`, and says whether any
 * header moved. `stop` ends the watch.
 */
export function followTextureSampling(colour: WebgpuTileAtlas, data: WebgpuTileAtlas) {
  const atlases = [atlasSampling(colour), atlasSampling(data)];
  const revised = new Set<Texture>();
  return {
    all() {
      for (const atlas of atlases) atlas.all();
    },
    revised(colourMoved: Set<number>) {
      if (!revised.size) return false;
      colourMoved.clear();
      const moved = atlases[0].revised(revised, colourMoved);
      const any = atlases[1].revised(revised) || moved;
      revised.clear();
      return any;
    },
    stop: watchTextureRevisions(revised),
  };
}
