import { followHostTexture, hostTextureWrites } from '../../host/textureImport.ts';
import type { WebgpuTileAtlas } from './atlas.ts';
import { PAGE_FILTER_SHIFT, PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from './pageTable.ts';
import { SAMPLE_FILTER_MASK } from './sampling.ts';

/** True when the texture at `slot` of a page table has a filter word: it is read through its
 *  filter rule. Slot 0, the fill texel, never has one. */
export function slotSampled({ words }: { readonly words: Uint32Array }, slot: number) {
  const word = words[PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS + 2];
  return ((word >>> PAGE_FILTER_SHIFT) & SAMPLE_FILTER_MASK) !== 0;
}

/** Copies a moved picture into the places its slot holds; false when it could not. `keep` false:
 *  the same picture, reduced again, whose working texture need not stay. */
type PictureCopy = (atlas: WebgpuTileAtlas, slot: number, keep?: boolean) => boolean;

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
 * first does not hide the change from this one. No slot is walked while no host write was
 * announced since the last follow: a still scene costs one comparison, and the coverage rule of
 * its host colour textures (`coverageRules`). `force` writes every header, the first time.
 * Colour slots whose header moved are added to `colorMoved`; the result is a mask of
 * `HEADERS_WRITTEN` and `HEADERS_SWITCHED`. The same walk hands `copy` each host-image slot
 * whose picture moved since the last follow — a new version of its record —, for its places in
 * the pool to be copied again (#362); one copied counts as a written header.
 */
export function samplingHeaders(color: WebgpuTileAtlas, data: WebgpuTileAtlas) {
  const atlasHeaders = (atlas: WebgpuTileAtlas) => {
    const { pages, textures } = atlas;
    /** `sampling + placement` of each slot's record when its header was written: both monotonic. */
    const seen = new Float64Array(textures.length).fill(-1);
    /** The record's `version` each host-image slot's pool places were last written at. */
    const pictures = textures.map(({ texture }) => texture?.version ?? 0);
    return (force: boolean, moved?: Set<number>, copy?: PictureCopy) => {
      let result = 0;
      for (let slot = 0; slot < textures.length; slot++) {
        const { texture, source } = textures[slot];
        if (!texture) continue;
        followHostTexture(texture);
        if (source.kind === 'host' && pictures[slot] !== texture.version) {
          pictures[slot] = texture.version;
          if (copy?.(atlas, slot)) {
            result |= HEADERS_WRITTEN;
            moved?.add(slot);
          }
        }
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
    other = atlasHeaders(data),
    coverage = coverageRules(color);
  let followed = -1;
  return (force: boolean, colorMoved?: Set<number>, copy?: PictureCopy) => {
    const recopied = copy ? coverage(copy, colorMoved) : 0;
    if (!force && followed === hostTextureWrites()) return recopied;
    followed = hostTextureWrites();
    return recopied | colour(force, colorMoved, copy) | other(force, undefined, copy);
  };
}

/**
 * The coverage rule each host colour texture's chain was reduced under, followed at every image
 * (#42): a host switches a surface between opaque and masked without a new prepare, and a texture
 * whose readers' rule moved (`CoverageReaders`) is reduced again under the new one and copied into
 * its places by `copy`, as a moved picture is; its slot is added to `moved`. Only host slots are
 * walked: a cooked chain keeps the rule the compiler baked.
 */
function coverageRules(atlas: WebgpuTileAtlas) {
  const hosts = atlas.textures.flatMap(({ source }, slot) =>
    source.kind === 'host' ? [{ slot, coverage: source.coverage, rule: source.coverage() }] : [],
  );
  return (copy: PictureCopy, moved?: Set<number>) => {
    let result = 0;
    for (const host of hosts) {
      const rule = host.coverage();
      if (rule === host.rule) continue;
      host.rule = rule;
      if (!copy(atlas, host.slot, false)) continue;
      result |= HEADERS_WRITTEN;
      moved?.add(host.slot);
    }
    return result;
  };
}
