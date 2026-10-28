import type { Texture } from '../../../../../sdk-core/src/texture/contract.ts'
import type { WebgpuTileAtlas } from '../atlas/atlasTypes.ts'
import { PAGE_FILTER_SHIFT, SLOT_FILTER_WORD, slotHeader } from '../page/pageTable.ts'
import type { StreamedFiltering } from '../streamer/streamerParts.ts'
import { SAMPLE_SLOT_MASK } from '../../texture/sampling.ts'

/** True when the texture at `slot` of a page table has a filter word, or is read once
 *  (`SAMPLE_ONE_READ`, the default of `virtualTextureAnisotropicFiltering`: the reference's rule is
 *  every streamed texture's, anisotropy 1 included): it is read through its filter rule. Slot 0, the fill texel, never has one. */
export function slotSampled({ words }: { readonly words: Uint32Array }, slot: number) {
  const word = words[slotHeader(slot) + SLOT_FILTER_WORD]
  return ((word >>> PAGE_FILTER_SHIFT) & SAMPLE_SLOT_MASK) !== 0
}

/** Copies a slot's texels again into the places it holds; false when it could not. */
type PictureCopy = (atlas: WebgpuTileAtlas, slot: number) => boolean
/** `refresh`: a moved picture. */
type TileCopies = { refresh: PictureCopy }

/** What a follow found: a header word moved, and a texture's filter rule switched on or off —
 *  the pages that wear it change resolve class (`FLAG_SAMPLED`). */
export const HEADERS_WRITTEN = 1,
  HEADERS_SWITCHED = 2

/** Which slot holds which record: `identities` by slot, `slots` by record — what a journaled record
 *  is looked up by. A slot leaves its record's list as it is released or takes another: no record is
 *  kept past its slots. */
function createHolds() {
  const identities: Array<Texture | undefined> = []
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
  return { identities, slots, hold }
}

/** The headers of one atlas's textures: the visit of a slot, and the pass over the slots a force or
 *  the journal names. */
function atlasHeaders(
  atlas: WebgpuTileAtlas,
  journal: ReadonlySet<Texture>,
  filtering: () => StreamedFiltering,
) {
  const { textures } = atlas
  /** `sampling + placement` of each slot's record when its header was written: both monotonic;
   *  none yet for a slot appended after open. */
  const seen: number[] = []
  /** The record's `version` each host-image slot's pool places were last written at: a slot
   *  appended after open was pinned from the picture it has when first visited. */
  const pictures: number[] = []
  const { identities, slots, hold } = createHolds()
  const visit = (slot: number, force: boolean, copies?: TileCopies) => {
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
      if (copies?.refresh(atlas, slot)) result |= HEADERS_WRITTEN
    }
    const revision = texture.sampling + texture.placement
    if (!force && seen[slot] === revision) return result
    seen[slot] = revision
    const { pages } = atlas
    const was = slotSampled(pages, slot)
    const { ceiling, taps } = filtering()
    if (!pages.setSampling(slot, texture, ceiling, taps)) return result
    return result | HEADERS_WRITTEN | (was === slotSampled(pages, slot) ? 0 : HEADERS_SWITCHED)
  }
  return (force: boolean, copies?: TileCopies, all = false) => {
    let result = 0
    // The ceiling moved: every live slot's header is written again under it.
    if (all) {
      for (let slot = 0; slot < textures.length; slot++)
        if (textures[slot].texture) result |= visit(slot, true, copies)
      return result
    }
    // A regrown table copied existing headers. Only a new/reused slot was just uploaded;
    // pending picture and filter changes on its neighbours still belong to the next frame.
    if (force) {
      for (let slot = 0; slot < textures.length; slot++) {
        const { texture } = textures[slot]
        // A released slot forgets its record: reused, even by the same one, it is new.
        if (!texture) {
          if (identities[slot]) hold(slot, undefined)
        } else if (identities[slot] !== texture) result |= visit(slot, true, copies)
      }
      return result
    }
    for (const record of journal)
      for (const slot of slots.get(record) ?? [])
        // A slot released or reused since holds another record: its own write is journaled.
        if (textures[slot].texture === record) result |= visit(slot, false, copies)
    return result
  }
}

/**
 * The sampling headers of both atlases' textures, written per texture and not per
 * surface — however many passes wear it, a transparent one included —, only the words that moved
 * (`setSampling`, `../page/pageTable.ts`). A record's own write lands it in `journal`
 * (`../../../../../sdk-core/src/texture/writes.ts`): each render visits the slots of the records
 * written since the last, and nothing else — one write among ten thousand textures visits one
 * slot. A slot's header is rewritten only when its record's counters moved past the ones it was
 * last written at. `force` visits every slot not seen yet: the first time, and each slot a growth
 * appended. The result is a mask of `HEADERS_WRITTEN` and `HEADERS_SWITCHED`. The same visit hands `copies` each host-image slot
 * whose picture moved since — a new version of its record —, for its places in the pool to be
 * copied again; one copied counts as a written header. `filtering` is what the headers are written
 * under, read each image: the anisotropy ceiling (`virtualTextureMaxAnisotropy`) and whether the
 * reads take taps (`virtualTextureAnisotropicFiltering`); when either moves, every header is written
 * again, once.
 */
export function samplingHeaders(
  color: WebgpuTileAtlas,
  data: WebgpuTileAtlas,
  journal: ReadonlySet<Texture> & { clear(): void },
  filtering: () => StreamedFiltering,
) {
  const colour = atlasHeaders(color, journal, filtering),
    other = atlasHeaders(data, journal, filtering)
  let held = filtering()
  return (force: boolean, copies?: TileCopies) => {
    let result = 0
    // A moved ceiling (`virtualTextureMaxAnisotropy`) or switch (`virtualTextureAnisotropicFiltering`)
    // writes every header again, once.
    const now = filtering()
    const all = now !== held
    held = now
    if (force || all || journal.size) {
      result = colour(force, copies, all) | other(force, copies, all)
      if (!force) journal.clear()
    }
    return result
  }
}
