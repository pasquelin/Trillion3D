import { followHostTexture } from '../../host/textureImport.ts';
import type { WebgpuTileAtlas } from './atlas.ts';
import { PAGE_FILTER_SHIFT, PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from './pageTable.ts';
import { SAMPLE_FILTER_MASK } from './sampling.ts';

/** True when the texture at `slot` of a page table has a filter word: it is read through its
 *  filter rule. Slot 0, the fill texel, never has one. */
export function slotSampled({ words }: { readonly words: Uint32Array }, slot: number) {
  const word = words[PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS + 2];
  return ((word >>> PAGE_FILTER_SHIFT) & SAMPLE_FILTER_MASK) !== 0;
}

/** What a follow found: a header word moved, and a texture's filter rule switched on or off —
 *  the pages that wear it change resolve class (`FLAG_SAMPLED`). */
export const HEADERS_WRITTEN = 1,
  HEADERS_SWITCHED = 2;

/**
 * The sampling headers of both atlases' textures (#360, #361), written per texture and not per
 * surface — however many passes wear it, a transparent one included —, only the words that moved
 * (`setSampling`, `pageTable.ts`). Each atlas walks the records it holds, brings each up to its
 * host at this render (`followHostTexture`), and rewrites a header only when the record's
 * counters moved past the ones it was last written at: another engine following the same record
 * first does not hide the change from this one. `force` writes every header, the first time.
 * Colour slots whose header moved are added to `colorMoved`; the result is a mask of
 * `HEADERS_WRITTEN` and `HEADERS_SWITCHED`.
 */
export function samplingHeaders(color: WebgpuTileAtlas, data: WebgpuTileAtlas) {
  const atlasHeaders = ({ pages, textures }: WebgpuTileAtlas) => {
    /** `sampling + placement` of each slot's record when its header was written: both monotonic. */
    const seen = new Float64Array(textures.length).fill(-1);
    return (force: boolean, moved?: Set<number>) => {
      let result = 0;
      for (let slot = 0; slot < textures.length; slot++) {
        const { texture, source } = textures[slot];
        if (!texture) continue;
        followHostTexture(texture);
        const revision = texture.sampling + texture.placement;
        if (!force && seen[slot] === revision) continue;
        seen[slot] = revision;
        const was = slotSampled(pages, slot);
        if (!pages.setSampling(slot, texture, source.kind !== 'host')) continue;
        result |= HEADERS_WRITTEN | (was === slotSampled(pages, slot) ? 0 : HEADERS_SWITCHED);
        moved?.add(slot);
      }
      return result;
    };
  };
  const colour = atlasHeaders(color),
    other = atlasHeaders(data);
  return (force: boolean, colorMoved?: Set<number>) => colour(force, colorMoved) | other(force);
}
