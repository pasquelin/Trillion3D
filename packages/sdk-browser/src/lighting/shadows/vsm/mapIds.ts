/**
 * THE ID HALF OF THE SHADOW MAP ARRAY, a frame's (`frameSetup.ts`): the ids of the maps in two ranges,
 * as the reference lays them (`AllocateShadowMapSlots`) — the maps of one page (a distant light's) from
 * id 0, in a range of fixed size (`VSM_MAX_SINGLE_PAGE_MAPS`), then the full maps from the end of it, the suns' clipmaps
 * first, then the local lights'. A frame's ids are then the slots up to the last full map's (`mapCount`), its
 * maps those it claimed (`claimedCount`), the slots between the two ranges holding none. In each range a light comes before the entries no light referenced.
 * A map is given its id by the order of its run (`VSM_ID_RUN`) whatever the order it was claimed in:
 * a claim is the entry and its map count, and the ids are laid once every claim is made (`seal`).
 * Nothing is moved by a claim: the entries take their ids when the frame's plan is kept
 * (`VsmCacheManager.commitIds`). A light is given its maps whatever the count: the map slots grow to
 * hold them (`planVirtualShadowFrame`). The next-map data each map leaves under its previous id is kept
 * here too. Where each map's table lies is the table packing's (`tableBlocks.ts`).
 */
import { VSM_MAX_SINGLE_PAGE_MAPS, VSM_RECORD_MAP_COUNT, VSM_NEXT_ID_VALID } from './constants.ts'
import type { VsmLightCache, VsmNextMap } from './lightCache.ts'

/** Next-map data stride on the GPU (`VsmNextMap`). */
export const VSM_NEXT_MAP_BYTES = 16

/** The runs of ids, in the order they lie: the maps of one page of the lights, then of the entries no
 *  light referenced (both in the first range); the suns' clipmaps; the full maps of the lights, then of the entries no light
 *  referenced (from the end of the first range). */
const SINGLE_PAGE = 0,
  SUN = 2,
  FULL = 3,
  RUNS = 5

/** What claims a run: a sun's clipmap, a local light, an entry no light referenced. */
type VsmClaimKind = 'sun' | 'light' | 'unreferenced'

/** One entry's claim on `count` ids of a run, its first id once the claims are sealed. */
interface VsmIdClaim {
  entry: VsmLightCache
  run: number
  /** The ids before it in its run. */
  offset: number
  count: number
  unreferenced: boolean
  id: number
}

/** The id half of the shadow map array. */
export class VsmMapIds {
  /** The slots of the frame's ids: [0, mapCount), the maps of one page first, the full maps from the end of the range reserved for them
   *  (`VSM_MAX_SINGLE_PAGE_MAPS`); the bound of a loop over the ids, zero where no map was claimed. */
  mapCount = 0
  /** The maps claimed this frame. */
  claimedCount = 0
  /** The maps of one page claimed: the ids [0, singleCount). */
  singleCount = 0
  /** The id of the first sun's first map: the suns' clipmaps lie from it, the prefiltered distant
   *  shadow's history addresses them from it (`vsmHistoryLayout`). */
  sunBase = 0
  /** More maps of one page than their range holds, or slots than an id can name (`VSM_RECORD_MAP_COUNT`): no set holds them. */
  exhausted = false
  /** The next-map data count: one past the largest previous id given next data
   *  this frame; the ids below it given none read zero (flags 0 = no caching). */
  nextMapCount = 0
  /** The previous ids given next data this frame: the first `nextMapIdCount`, in call order. */
  readonly nextMapIds: number[] = []
  nextMapIdCount = 0
  /** Each previous id's record, kept across frames (`reset`), this frame's those listed. */
  readonly nextMaps: VsmNextMap[] = []
  /** The frame's claims: the first `claimCount`, in the order they were made. */
  readonly claims: VsmIdClaim[] = []
  claimCount = 0
  private readonly held = new Map<VsmLightCache, VsmIdClaim>()
  private readonly runSizes = new Int32Array(RUNS)
  private readonly runStarts = new Int32Array(RUNS)

  /** Empties the allocator for a new frame, keeping its storage. */
  reset() {
    this.mapCount = this.sunBase = this.claimCount = this.claimedCount = this.singleCount = 0
    this.exhausted = false
    this.nextMapCount = 0
    this.nextMapIdCount = 0
    this.held.clear()
    this.runSizes.fill(0)
    return this
  }

  /** Claims ids for the maps of `entry`, in the run of `kind` its distance puts it in. A map that had
   *  an id has next-map data under it: its count is known now. */
  claim(entry: VsmLightCache, kind: VsmClaimKind) {
    const unreferenced = kind === 'unreferenced',
      run = kind === 'sun' ? SUN : (entry.distant ? SINGLE_PAGE : FULL) + (unreferenced ? 1 : 0),
      count = entry.mapCaches.length
    const claim = (this.claims[this.claimCount++] ??= {} as VsmIdClaim)
    claim.entry = entry
    claim.run = run
    claim.offset = this.runSizes[run]
    claim.count = count
    claim.unreferenced = unreferenced
    claim.id = -1
    this.runSizes[run] += count
    this.claimedCount += count
    if (entry.mapId >= 0) this.nextMapCount = Math.max(this.nextMapCount, entry.mapId + count)
    this.held.set(entry, claim)
  }

  /** Lays the runs out and gives every claim its id: the maps of one page from id 0, the full maps from the end of the range reserved for the
   *  first. */
  seal() {
    const starts = this.runStarts,
      sizes = this.runSizes
    starts[SINGLE_PAGE] = 0
    starts[SINGLE_PAGE + 1] = sizes[SINGLE_PAGE]
    this.singleCount = sizes[SINGLE_PAGE] + sizes[SINGLE_PAGE + 1]
    starts[SUN] = VSM_MAX_SINGLE_PAGE_MAPS
    starts[FULL] = starts[SUN] + sizes[SUN]
    starts[FULL + 1] = starts[FULL] + sizes[FULL]
    const full = this.claimedCount - this.singleCount
    this.mapCount = full > 0 ? VSM_MAX_SINGLE_PAGE_MAPS + full : this.singleCount
    this.exhausted =
      this.singleCount > VSM_MAX_SINGLE_PAGE_MAPS || this.mapCount > VSM_RECORD_MAP_COUNT
    this.sunBase = starts[SUN]
    for (let i = 0; i < this.claimCount; i++) {
      const claim = this.claims[i]
      claim.id = starts[claim.run] + claim.offset
    }
  }

  /** Whether `entry` claimed ids this frame. */
  holds(entry: VsmLightCache) {
    return this.held.has(entry)
  }

  /** The id of the first map of `entry`, which claimed (sealed). */
  firstIdOf(entry: VsmLightCache) {
    return this.held.get(entry)!.id
  }

  /** Records a map's next-frame data under its previous id, which has a next one. */
  writeNextMap(prevId: number, data: VsmNextMap) {
    const slot = (this.nextMaps[prevId] ??= {
      flags: 0,
      nextMapId: 0,
      pageShift: [0, 0],
    })
    slot.flags = data.flags | VSM_NEXT_ID_VALID
    slot.nextMapId = data.nextMapId
    slot.pageShift[0] = data.pageShift[0]
    slot.pageShift[1] = data.pageShift[1]
    this.nextMapIds[this.nextMapIdCount++] = prevId
    if (prevId >= this.nextMapCount) this.nextMapCount = prevId + 1
  }
}
