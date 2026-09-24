import { AFFINE } from '../../../../sdk-core/src/texture/contract.ts';
import { followHostTexture, hostTextureOf } from '../../host/surfaceImport.ts';
import type { WebgpuTileAtlas } from './atlas.ts';
import { PAGE_HEADER_WORDS, PAGE_SLOT_WORDS, PAGE_TRANSFORM_WORD } from './pageTable.ts';
import { TRANSFORM_WORDS } from './sampling.ts';

/** What a follower found moved, one bit each. */
export const HEADERS_MOVED = 1,
  ADDRESSING_MOVED = 2;

/**
 * Follows the sampling of an atlas's textures into their page-table headers (#360, #361), per
 * texture and not per surface: however many surfaces and passes wear a texture — an opaque page,
 * a transparent item —, its header is written from its record alone.
 *
 * Returns the follower, run once per image before the hold verdict. Every texture held is brought
 * up to its host (`followHostTexture` — the UV matrix recomposed, the fields refilled when the
 * version or the image moved), then its state is compared with the one its header was written
 * from: the record version, and the six affine floats the header holds. Only a texture whose
 * state moved has its words — filters, granted anisotropy, transform — spelled out and written
 * where one moved (`setSampling`). The follower adds each slot whose header moved to `moved` and
 * returns `HEADERS_MOVED`, and `ADDRESSING_MOVED` for a refill that moved an addressing, which
 * the page rows fold, not the header. Nothing is allocated per call.
 */
export function followAtlasSampling({ pages, textures }: WebgpuTileAtlas) {
  const versions = new Float64Array(textures.length).fill(NaN),
    floats = new Float32Array(pages.words.buffer),
    hosts = textures.map(({ texture }) => texture && hostTextureOf(texture));
  const held = (at: number, m: readonly number[]) => {
    for (let i = 0; i < TRANSFORM_WORDS; i++)
      if (floats[at + i] !== Math.fround(m[AFFINE[i]])) return false;
    return true;
  };
  return (moved?: Set<number>) => {
    let found = 0;
    for (let slot = 0; slot < textures.length; slot++) {
      const { texture, source } = textures[slot];
      if (!texture) continue;
      if (hosts[slot] && followHostTexture(texture, hosts[slot])) found |= ADDRESSING_MOVED;
      const at = PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS + PAGE_TRANSFORM_WORD;
      if (versions[slot] === texture.version && held(at, texture.transform)) continue;
      versions[slot] = texture.version;
      if (!pages.setSampling(slot, texture, source.kind !== 'host')) continue;
      found |= HEADERS_MOVED;
      moved?.add(slot);
    }
    return found;
  };
}
