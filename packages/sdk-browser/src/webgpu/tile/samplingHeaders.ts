import type { Texture } from '../../../../sdk-core/src/index.ts'
import type { CoverageReaders } from '../../texture/coverage.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import { PAGE_FILTER_SHIFT, PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from './pageTable.ts'
import { SAMPLE_FILTER_MASK } from '../../texture/sampling.ts'

/** True when the texture at `slot` of a page table has a filter word: it is read through its
 *  filter rule. Slot 0, the fill texel, never has one. */
export function slotSampled({ words }: { readonly words: Uint32Array }, slot: number) {
  const word = words[PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS + 2]
  return ((word >>> PAGE_FILTER_SHIFT) & SAMPLE_FILTER_MASK) !== 0
}

/** Copies a slot's texels again into the places it holds; false when it could not. */
type PictureCopy = (atlas: WebgpuTileAtlas, slot: number) => boolean
/** `refresh`: a moved picture; `reduce`: the same picture under a new coverage rule. */
type TileCopies = { refresh: PictureCopy; reduce: PictureCopy }

/** What a follow found: a header word moved, and a texture's filter rule switched on or off —
 *  the pages that wear it change resolve class (`FLAG_SAMPLED`). */
export const HEADERS_WRITTEN = 1,
  HEADERS_SWITCHED = 2

/**
 * The sampling headers of both atlases' textures, written per texture and not per
 * surface — however many passes wear it, a transparent one included —, only the words that moved
 * (`setSampling`, `pageTable.ts`). A record's own write lands it in `journal`
 * (`../../../../sdk-core/src/texture/writes.ts`): each render visits the slots of the records
 * written since the last, and nothing else — one write among ten thousand textures visits one
 * slot. A slot's header is rewritten only when its record's counters moved past the ones it was
 * last written at. `force` visits every slot not seen yet: the first time, and each slot a growth
 * appended. Colour slots whose header moved are added to `colorMoved`; the result is a mask of
 * `HEADERS_WRITTEN` and `HEADERS_SWITCHED`. The same visit hands `copies` each host-image slot
 * whose picture moved since — a new version of its record —, for its places in the pool to be
 * copied again; one copied counts as a written header. The readers of the host colour maps
 * follow the surfaces written since (`surfaces`, `../../page/surfaceWrites.ts`), and nothing else
 * (`coverageRules`), the rules weighed again only then or on `force`: a still scene costs one size
 * test.
 */
export function samplingHeaders(
  color: WebgpuTileAtlas,
  data: WebgpuTileAtlas,
  journal: ReadonlySet<Texture> & { clear(): void },
  surfaces: ReadonlySet<PageSurface> & { clear(): void },
) {
  const coverage = coverageRules(color)
  const atlasHeaders = (atlas: WebgpuTileAtlas, copied?: (slot: number) => void) => {
    const { textures } = atlas
    /** `sampling + placement` of each slot's record when its header was written: both monotonic;
     *  none yet for a slot appended after open. */
    const seen: number[] = []
    /** The record's `version` each host-image slot's pool places were last written at: a slot
     *  appended after open was pinned from the picture it has when first visited. */
    const pictures: number[] = []
    const identities: Array<Texture | undefined> = []
    /** The slots each record is held in: what a journaled record is looked up by. A slot leaves
     *  its record's list as it is released or takes another: no record is kept past its slots. */
    const slots = new Map<Texture, number[]>()
    /** Slot `slot` holds `texture` from now on, none when released. */
    const hold = (slot: number, texture: Texture | undefined) => {
      const was = identities[slot]
      if (was) {
        const held = slots.get(was)!.filter((other) => other !== slot)
        if (held.length) slots.set(was, held)
        else slots.delete(was)
      }
      identities[slot] = texture
      if (!texture) return
      const held = slots.get(texture)
      if (!held) slots.set(texture, [slot])
      else held.push(slot)
    }
    const visit = (slot: number, force: boolean, moved?: Set<number>, copies?: TileCopies) => {
      const { texture, source } = textures[slot]
      if (!texture) return 0
      let result = 0
      if (identities[slot] !== texture) {
        hold(slot, texture)
        pictures[slot] = texture.version
        seen[slot] = -1
      }
      if (source.kind === 'host' && pictures[slot] !== texture.version) {
        pictures[slot] = texture.version
        if (copies?.refresh(atlas, slot)) {
          copied?.(slot)
          result |= HEADERS_WRITTEN
          moved?.add(slot)
        }
      }
      const revision = texture.sampling + texture.placement
      if (!force && seen[slot] === revision) return result
      seen[slot] = revision
      const { pages } = atlas
      const was = slotSampled(pages, slot)
      if (!pages.setSampling(slot, texture)) return result
      moved?.add(slot)
      return result | HEADERS_WRITTEN | (was === slotSampled(pages, slot) ? 0 : HEADERS_SWITCHED)
    }
    return (force: boolean, moved?: Set<number>, copies?: TileCopies) => {
      let result = 0
      // A regrown table copied existing headers. Only a new/reused slot was just uploaded;
      // pending picture and filter changes on its neighbours still belong to the next frame.
      if (force) {
        for (let slot = 0; slot < textures.length; slot++) {
          const { texture } = textures[slot]
          // A released slot forgets its record: reused, even by the same one, it is new.
          if (!texture) {
            if (identities[slot]) hold(slot, undefined)
          } else if (identities[slot] !== texture) result |= visit(slot, true, moved, copies)
        }
        return result
      }
      for (const record of journal)
        for (const slot of slots.get(record) ?? [])
          // A slot released or reused since holds another record: its own write is journaled.
          if (textures[slot].texture === record) result |= visit(slot, false, moved, copies)
      return result
    }
  }
  const colour = atlasHeaders(color, (slot) => coverage.copied(slot)),
    other = atlasHeaders(data)
  return (force: boolean, colorMoved?: Set<number>, copies?: TileCopies) => {
    // The readers first: a picture copied again below reduces under the rule they declare now. A
    // rule moves only where a reader was filed again, or on a sync: else no map is weighed.
    if (force) coverage.sync()
    const filed = surfaces.size > 0
    if (copies && filed) coverage.follow(surfaces)
    let result = 0
    if (force || journal.size) {
      result = colour(force, colorMoved, copies) | other(force, undefined, copies)
      if (!force) journal.clear()
    }
    return copies && (force || filed) ? result | coverage.reduce(copies.reduce, colorMoved) : result
  }
}

/** The rule each host colour map's chain was reduced under, followed at every image: a map
 *  whose rule moved goes to `reduce`, its slot to `moved`; one just `copied` already carries it. */
function coverageRules(atlas: WebgpuTileAtlas) {
  let readers: CoverageReaders | undefined
  const hosts = new Map<number, { map: Texture; rule?: number }>()
  const ruleOf = (map: Texture) => readers?.cutoff(map)
  // Preserve the last uploaded rule for unchanged slots; retirement removes every strong map
  // reference, and reuse starts with the rule its new tail was actually reduced under.
  const sync = () => {
    for (const [slot, { source }] of atlas.textures.entries()) {
      if (source.kind !== 'host' || !(readers ??= source.coverage)) {
        hosts.delete(slot)
        continue
      }
      if (hosts.get(slot)?.map !== source.map)
        hosts.set(slot, { map: source.map, rule: ruleOf(source.map) })
    }
  }
  sync()
  return {
    sync,
    /** The readers follow the surfaces written since the last follow, then forget them. */
    follow(surfaces: ReadonlySet<PageSurface> & { clear(): void }) {
      readers?.follow(surfaces)
      surfaces.clear()
    },
    copied(slot: number) {
      const host = hosts.get(slot)
      if (host) host.rule = ruleOf(host.map)
    },
    reduce(reduce: PictureCopy, moved?: Set<number>) {
      let result = 0
      for (const [slot, host] of hosts) {
        const rule = ruleOf(host.map)
        if (rule === host.rule) continue
        host.rule = rule
        if (!reduce(atlas, slot)) continue
        result |= HEADERS_WRITTEN
        moved?.add(slot)
      }
      return result
    },
  }
}
