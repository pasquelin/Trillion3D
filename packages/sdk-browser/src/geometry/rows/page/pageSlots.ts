import type { PageRec } from '../../selection/types.ts'
import { alignUp } from '../../../../../math/src/scalar/integers.ts'
import type { PageUnit } from '../../pages/pool/homes.ts'
import type { RootSlots } from '../../pages/pool/placement.ts'

/**
 * The address one pool slot is held, pinned and read under, for one cluster record.
 *
 * Index pages are CONTENT-addressed: two primitives whose clusters carry the same index bytes
 * share one index-page url while each keeps a quantized geometry page of its own. The address is
 * therefore the geometry page's url wherever the record carries one, and the index page's url
 * otherwise — two such clusters take two slots and each decodes its own page, where one address
 * would have had one of them decode the other's bytes. A transparent cluster is no exception: its
 * forward draw decodes the same page (`../../../blend/shader.ts`).
 */
export const pageAddress = (rec: Pick<PageRec, 'url' | 'geometryPage'>) =>
  rec.geometryPage?.url ?? rec.url

/** Whether `rec` has a page: a record without one — a placed object's cluster in the world DAG
 *  (`../../hlod/worldRecords.ts`) — takes no slot, reads no vertex and draws nothing. */
export const hasPage = (rec: Pick<PageRec, 'url' | 'geometryPage'>) => pageAddress(rec) !== ''

/** The STREAMING PAGE `rec`'s address lies in, and where: its bundle (`PageRec.streamUrl`) at its
 *  offset there — what one pool slot holds and the residency streams whole
 *  (`../../residency/pageUnits.ts`) —, or for a record its cache gives no bundle, its own address
 *  at its start. The one rule of the pool's census (`describePageSlots`) and the residency's. */
export const pageUnit = (
  rec: Pick<PageRec, 'url' | 'geometryPage' | 'streamUrl' | 'streamOffset'>,
): PageUnit =>
  rec.streamUrl !== undefined && hasPage(rec)
    ? { unit: rec.streamUrl, offset: rec.streamOffset ?? 0 }
    : { unit: pageAddress(rec), offset: 0 }

/** The bytes a page takes in its pool slot, padded to a word: its geometry page's, else its
 *  index bytes. */
export const paddedPageBytes = (page: Pick<PageRec, 'geometryPage' | 'array' | 'indexBytes'>) =>
  alignUp(
    page.geometryPage ? page.geometryPage.bytes : (page.array?.byteLength ?? page.indexBytes),
    4,
  )

/** The corners a page draws: its geometry page's indices, else three a triangle. */
export const pageCorners = (page: Pick<PageRec, 'geometryPage' | 'triangles'>) =>
  page.geometryPage ? page.geometryPage.indexCount : page.triangles * 3

/**
 * Starts the read of a cluster's geometry page as the streaming starts the page, ahead of its
 * install (`../../residency/queue.ts`), through the host's page reader, the one the pool's own read
 * goes through, which joins it: the read, or none for a cluster without a geometry page, served
 * from memory.
 */
export const readGeometryAhead =
  (
    geometryUrls: ReadonlyMap<string, string>,
    read: (url: string, signal?: AbortSignal, priority?: number) => Promise<Uint8Array>,
  ) =>
  (rec: PageRec, signal?: AbortSignal) => {
    const url = geometryUrls.get(pageAddress(rec))
    return url === undefined ? undefined : read(url, signal)
  }

/**
 * Whether the read of a cluster's geometry page is refused for good, through the host's check
 * (`EngineContext.geometryPageFailed`): the page itself was given up, or another page of its
 * object was. Never for a cluster without a geometry page, served from memory.
 */
export const geometryFailedAhead =
  (geometryUrls: ReadonlyMap<string, string>, failed: (url: string) => boolean) =>
  (rec: PageRec) => {
    const url = geometryUrls.get(pageAddress(rec))
    return url !== undefined && failed(url)
  }

/**
 * What the geometry pool holds for the scene, walked once from the catalogue, then from the
 * records of each source added to the session (`held`, the census so far).
 *
 * A slot holds one STREAMING PAGE (`pageUnit`): its clusters' quantized geometry pages where the
 * cache carries them, their index pages otherwise, each at its offset there, and it is as wide as
 * the widest streaming page, so any admitted one fits (`pageBytes`; `units`, each address's page
 * and offset; `unitWidths`, each page's width — the end of its last cluster —; `unitPages`, the
 * most clusters one holds; `clusterBytes`, the widest cluster's page, which bounds a row's
 * triangles). That width is a BYTE count and says nothing about how many corners a
 * cluster draws: a page under twelve packed bytes per triangle is narrower than its own corner
 * list. The draw ceiling is therefore the catalogue's largest corner count, taken here and nowhere
 * else — a draw bounded by the slot's word count would silently drop the tail triangles of every
 * cluster the format compresses well.
 *
 * The slot's content is chosen per cluster ADDRESS (`geometryUrls`), while the row's
 * `FLAG_CLUSTER_PAGE` is decided per RECORD (`pageRowMaterial.ts`, from `rec.geometryPage`).
 * Two records at one address that disagreed would make one row decode index words as a page, and
 * `pageAddress` makes that impossible: a record's page is part of its address. The refusal below is
 * that invariant said out loud, on the one walk where both sides are read together.
 *
 * `homes` is each address's own width, its bytes padded to a word: the room its page has in its
 * streaming page, which a page joining the session later may not outgrow
 * (`../../../frame/prepare/catalogueGrowth.ts`). The pool gives each streaming page its own width
 * when the whole catalogue fits (`../../pages/pool/homes.ts`).
 */
export function describePageSlots(allPages: readonly PageRec[], held = pageSlotCensus()) {
  const { geometryUrls, homes, units, unitWidths, unitCounts } = held
  for (const page of allPages) {
    const geometry = page.geometryPage,
      address = pageAddress(page)
    if (!hasPage(page)) continue
    if (homes.has(address) && geometryUrls.get(address) !== geometry?.url)
      throw new Error(`CLUSTER_PAGE_DISAGREEMENT: ${address}`)
    if (geometry) {
      geometryUrls.set(address, geometry.url)
      held.fromGeometryPage++
    } else if (page.transparent) held.transparentClusters++
    else held.fromSourceGeometry++
    const padded = paddedPageBytes(page)
    if (padded > (homes.get(address) ?? 0)) homes.set(address, padded)
    if (padded > held.clusterBytes) held.clusterBytes = padded
    // An address keeps the streaming page it was first described in.
    let placed = units.get(address)
    if (!placed) {
      units.set(address, (placed = pageUnit(page)))
      const count = (unitCounts.get(placed.unit) ?? 0) + 1
      unitCounts.set(placed.unit, count)
      if (count > held.unitPages) held.unitPages = count
    }
    const end = placed.offset + padded
    if (end > (unitWidths.get(placed.unit) ?? 0)) unitWidths.set(placed.unit, end)
    if (end > held.pageBytes) held.pageBytes = end
    const corners = pageCorners(page)
    if (corners > held.maxCorners) held.maxCorners = corners
  }
  return held
}

/** The root region the streaming pages `addresses` lie in ask, as `census` describes them — the
 *  root cover's, which the pool holds beside its streaming slots (`../../pages/pool/placement.ts`,
 *  `RootSlots`) —: how many they are, each once, and the widest's bytes, a grain each. */
export function rootSlotsOf(
  census: Pick<PageSlotCensus, 'units' | 'unitWidths'>,
  addresses: Iterable<string>,
): RootSlots {
  const units = new Set<string>()
  let bytes = 0
  for (const address of addresses) {
    const unit = census.units.get(address)?.unit ?? address
    units.add(unit)
    bytes = Math.max(bytes, census.unitWidths.get(unit) ?? 0)
  }
  return { slots: units.size, bytes }
}

export type PageSlotCensus = ReturnType<typeof pageSlotCensus>

/** What `describePageSlots` has described so far: nothing. A source added to the session later
 *  is described on the census the open made. */
const pageSlotCensus = () => ({
  geometryUrls: new Map<string, string>(),
  pageBytes: 4,
  clusterBytes: 4,
  homes: new Map<string, number>(),
  units: new Map<string, PageUnit>(),
  unitWidths: new Map<string, number>(),
  unitCounts: new Map<string, number>(),
  unitPages: 1,
  maxCorners: 1,
  fromGeometryPage: 0,
  fromSourceGeometry: 0,
  transparentClusters: 0,
})

/**
 * True while this cluster still waits for bytes it cannot draw without.
 *
 * A cluster the cache gave a quantized geometry page draws from that page alone: the pool reads it
 * at the cluster's own address (`../../../frame/backend/services.ts`) and the shaders decode it in place. Its
 * index page is never requested, never downloaded and never held on the CPU — the only number the
 * row ever wanted from it, the corner count, the geometry page declares itself.
 */
export const awaitsPageBytes = (rec: PageRec) => !rec.geometryPage && !rec.array

/** True while a record, or a bundle it is installed after (`PageRec.dependencies`), still waits
 *  for its bytes: the pool cannot admit it before them. */
export const awaitsClosure = (rec: PageRec) => {
  if (awaitsPageBytes(rec)) return true
  const dependencies = rec.dependencies
  if (dependencies)
    for (let i = 0; i < dependencies.length; i++) if (awaitsPageBytes(dependencies[i])) return true
  return false
}

/** The records of `pages` whose bytes, or those of their closure, are still awaited, collected
 *  into `into`: what the host is asked to fetch, and what an image is still missing. */
export function awaitedPages(pages: readonly PageRec[], into: PageRec[]) {
  into.length = 0
  for (let i = 0; i < pages.length; i++) if (awaitsClosure(pages[i])) into.push(pages[i])
  return into
}
