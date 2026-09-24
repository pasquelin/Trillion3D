import type { WebgpuTileAtlas } from './atlas.ts';
import { PAGE_HEADER_WORDS, PAGE_SLOT_WORDS, PAGE_TRANSFORM_WORD } from './pageTable.ts';
import { transformHeld } from './sampling.ts';

/**
 * Follows the sampling of an atlas's textures — filters, anisotropy, UV transform — into their
 * page-table headers (#360, #361), per texture and not per surface: however many surfaces and
 * passes read a texture, its header is written once per record version. A host recomposes a UV
 * matrix without a version (`../../host/surfaceImport.ts`), so the transform is compared as well.
 *
 * Returns the follower: it writes the headers whose record moved, adds each slot whose words moved
 * to `moved`, and says whether one did. Nothing is allocated per call.
 */
export function followAtlasSampling({ pages, textures }: WebgpuTileAtlas) {
  const versions = new Float64Array(textures.length).fill(NaN),
    floats = new Float32Array(pages.words.buffer);
  return (moved?: Set<number>) => {
    let any = false;
    for (let slot = 0; slot < textures.length; slot++) {
      const { texture, source } = textures[slot];
      if (!texture) continue;
      const at = PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS + PAGE_TRANSFORM_WORD;
      if (versions[slot] === texture.version && transformHeld(floats, at, texture.transform))
        continue;
      versions[slot] = texture.version;
      if (!pages.setSampling(slot, texture, source.kind !== 'host')) continue;
      any = true;
      moved?.add(slot);
    }
    return any;
  };
}
