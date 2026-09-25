import { followHostTexture, hostTextureWrites } from '../../host/textureImport.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import type { CoverageReaders } from '../../texture/coverage.ts';
import type { WebgpuTileAtlas } from './atlas.ts';
import { PAGE_FILTER_SHIFT, PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from './pageTable.ts';
import { SAMPLE_FILTER_MASK } from './sampling.ts';

/** True when the texture at `slot` of a page table has a filter word: it is read through its
 *  filter rule. Slot 0, the fill texel, never has one. */
export function slotSampled({ words }: { readonly words: Uint32Array }, slot: number) {
  const word = words[PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS + 2];
  return ((word >>> PAGE_FILTER_SHIFT) & SAMPLE_FILTER_MASK) !== 0;
}

/** Copies a slot's texels again into the places it holds; false when it could not. */
type PictureCopy = (atlas: WebgpuTileAtlas, slot: number) => boolean;
/** `refresh`: a moved picture (#362); `reduce`: the same picture under a new coverage rule (#42). */
type TileCopies = { refresh: PictureCopy; reduce: PictureCopy };

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
 * announced since the last follow: a still scene costs one comparison and a reread of its host
 * colour maps' readers (`coverageRules`). `force` writes every header, the first time.
 * Colour slots whose header moved are added to `colorMoved`; the result is a mask of
 * `HEADERS_WRITTEN` and `HEADERS_SWITCHED`. The same walk hands `copies` each host-image slot
 * whose picture moved since the last follow — a new version of its record —, for its places in
 * the pool to be copied again (#362); one copied counts as a written header.
 */
export function samplingHeaders(color: WebgpuTileAtlas, data: WebgpuTileAtlas) {
  const coverage = coverageRules(color);
  const atlasHeaders = (atlas: WebgpuTileAtlas, copied?: (slot: number) => void) => {
    const { pages, textures } = atlas;
    /** `sampling + placement` of each slot's record when its header was written: both monotonic. */
    const seen = new Float64Array(textures.length).fill(-1);
    /** The record's `version` each host-image slot's pool places were last written at. */
    const pictures = textures.map(({ texture }) => texture?.version ?? 0);
    return (force: boolean, moved?: Set<number>, copies?: TileCopies) => {
      let result = 0;
      for (let slot = 0; slot < textures.length; slot++) {
        const { texture, source } = textures[slot];
        if (!texture) continue;
        followHostTexture(texture);
        if (source.kind === 'host' && pictures[slot] !== texture.version) {
          pictures[slot] = texture.version;
          if (copies?.refresh(atlas, slot)) {
            copied?.(slot);
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
  const colour = atlasHeaders(color, coverage.copied),
    other = atlasHeaders(data);
  let followed = -1;
  return (force: boolean, colorMoved?: Set<number>, copies?: TileCopies) => {
    // The readers first: a picture copied again below reduces under the rule they declare now.
    if (copies) coverage.follow();
    let result = 0;
    if (force || followed !== hostTextureWrites()) {
      followed = hostTextureWrites();
      result = colour(force, colorMoved, copies) | other(force, undefined, copies);
    }
    return copies ? result | coverage.reduce(copies.reduce, colorMoved) : result;
  };
}

/**
 * The coverage rule each host colour map's chain was reduced under, followed at every image (#42):
 * a host switches a surface between opaque and masked without a new prepare. `reduce` hands each
 * map whose rule moved to `reduce` and adds its slot to `moved`; one whose picture was just
 * `copied` carries the rule already: never reduced twice. A cooked chain keeps the compiler's.
 */
function coverageRules(atlas: WebgpuTileAtlas) {
  const hosts = new Map<number, { map: Texture; readers: CoverageReaders; rule: boolean }>();
  for (const [slot, { source }] of atlas.textures.entries())
    if (source.kind === 'host' && source.coverage)
      hosts.set(slot, { map: source.map, readers: source.coverage, rule: false });
  for (const host of hosts.values()) host.rule = host.readers.weighs(host.map);
  const census = new Set([...hosts.values()].map((host) => host.readers));
  return {
    follow() {
      for (const readers of census) readers.follow();
    },
    copied(slot: number) {
      const host = hosts.get(slot);
      if (host) host.rule = host.readers.weighs(host.map);
    },
    reduce(reduce: PictureCopy, moved?: Set<number>) {
      let result = 0;
      for (const [slot, host] of hosts) {
        const rule = host.readers.weighs(host.map);
        if (rule === host.rule) continue;
        host.rule = rule;
        if (!reduce(atlas, slot)) continue;
        result |= HEADERS_WRITTEN;
        moved?.add(slot);
      }
      return result;
    },
  };
}
