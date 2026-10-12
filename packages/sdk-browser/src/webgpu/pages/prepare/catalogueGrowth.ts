/**
 * THE CATALOGUE TAKES THE PAGES OF A SOURCE ADDED TO THE SESSION (`addPlacements`). The tables the
 * open made once for the pages it held — the request ranks and their stamps, the host's rank delta,
 * the residency keys, the pages by request, the slot widths, the root cover and the pool's floor —
 * take the new records behind the ones they hold, by the rule the open numbered them with: an
 * address or a request key the session knows keeps its rank, a new one takes the next. Nothing is
 * walked but the records added.
 *
 * What the pool must hold for them is drawn again from the catalogue (`growWebgpuPagePool`): the
 * homes of the new addresses behind the others, a slot widened where a page asks it.
 */
import type { PageRec, ClusterRoot } from '../../../page/selection/types.ts'
import { indexPageRequests, pageRequestUrl } from '../../../page/selection/requests.ts'
import { describePageSlots, pageAddress } from '../../row/pageSlots.ts'
import { pageSourceBytes } from '../io/catalogue.ts'
import { KEY_PAGE_MAX } from '../../../gpu/dag/evict.ts'
import { growCoverKeys } from '../../residency/coverKeys.ts'
import type { GrownPages } from '../../../gpu/page/resize.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { coverPagesOf } from './rootCover.ts'

type Root = ClusterRoot<PageRec>

/** What a collection of a source brings the catalogue (`createCollector`). */
export type Brought = { allPages: PageRec[]; roots: Root[] }

/** The bytes a page takes in its pool slot, padded to a word. */
const paddedBytes = (page: PageRec) => {
  const n = page.geometryPage
    ? page.geometryPage.bytes
    : (page.array?.byteLength ?? page.indexBytes)
  return n + (n % 4 ? 4 - (n % 4) : 0)
}
const cornersOf = (page: PageRec) =>
  page.geometryPage ? page.geometryPage.indexCount : page.triangles * 3

/** Why the catalogue cannot take `pages` where it stands, said by name; none when it can. */
export function catalogueRefusal(rt: WebgpuPagesRuntime, pages: readonly PageRec[]) {
  const { tracking, census, maxCorners } = rt.setup
  const added = new Set<string>()
  for (const page of pages) {
    if ((page.level ?? 0) > tracking.topLevel) return 'a page deeper than the levels ranked'
    if (cornersOf(page) > maxCorners) return 'a page wider than the draw batches'
    const address = pageAddress(page),
      home = census.homes.get(address)
    if (home === undefined) added.add(address)
    else if (census.geometryUrls.get(address) !== page.geometryPage?.url)
      return 'an address of two pages'
    else if (paddedBytes(page) > home) return 'a page wider than its home'
  }
  if (tracking.pageCatalog.length + added.size > KEY_PAGE_MAX) return 'KEY_PAGE_MAX'
  return undefined
}

/**
 * The catalogue holds `brought` from now on (`catalogueRefusal` said it can): its records ranked
 * by request and by key, listed by request, described for the pool. Returns what the pool must be
 * drawn for, and the cover its roots add, which the session holds once the pool has it
 * (`holdCatalogueCover`).
 */
export function growCatalogue(rt: WebgpuPagesRuntime, brought: Brought) {
  const { setup } = rt,
    { allPages, roots } = brought
  // The request ranks, and every table indexed by rank.
  const urls = setup.requestUrls
  indexPageRequests(allPages, setup.requests)
  for (const page of allPages)
    if (page.requestIndex === urls.length) urls.push(pageRequestUrl(page))
  setup.requestStamps.grow(urls.length)
  setup.hostRanks.grow(urls.length)
  // The residency keys, and the table of the cover over them.
  const { tracking } = setup
  tracking.append(allPages)
  growCoverKeys(setup.bootstrapKey, tracking.keyCount)
  for (const page of allPages) {
    const request = pageRequestUrl(page)
    const list = setup.byUrl.get(request)
    if (list) list.push(page)
    else setup.byUrl.set(request, [page])
    const bytes = pageSourceBytes(page)
    if (bytes) setup.sourceBytes.set(pageAddress(page), bytes)
    setup.allPages.push(page)
  }
  // What the pool lays out: the pages' widths, the addresses they add.
  const { census } = setup
  const fresh = new Set<string>()
  for (const page of allPages)
    if (!census.homes.has(pageAddress(page))) fresh.add(pageAddress(page))
  describePageSlots(allPages, census)
  const widths = new Map<string, number>()
  let added = 0
  for (const address of fresh) {
    const width = census.homes.get(address)!
    widths.set(address, width)
    added += width
  }
  setup.pageBytes = Math.max(setup.pageBytes, census.pageBytes)
  const cover = growCover(setup, roots)
  Object.assign(setup.geometryShape, {
    pageBytes: setup.pageBytes,
    uniquePages: census.homes.size,
    homeBytes: (setup.geometryShape.homeBytes ?? 0) + added,
    rootPages: setup.floorPages,
  })
  return { grown: { pageBytes: setup.pageBytes, widths } satisfies GrownPages, cover }
}

/** The cover the roots added hold whatever the view, listed by the catalogue; the pages its groups
 *  replace raise the pool's floor. */
function growCover(setup: WebgpuPagesRuntime['setup'], roots: readonly Root[]) {
  const { bootstrap, children } = coverPagesOf(roots)
  const covered = bootstrap.filter((page) => !setup.coverUrls.has(pageAddress(page)))
  for (const page of covered) {
    setup.coverUrls.add(pageAddress(page))
    setup.floorUrls.add(pageAddress(page))
    setup.bootstrap.push(page)
  }
  for (const page of children) setup.floorUrls.add(pageAddress(page))
  return covered
}

/** The session holds `cover`, loaded before any other page as the open's cover is. */
export function holdCatalogueCover(rt: WebgpuPagesRuntime, cover: readonly PageRec[]) {
  if (!cover.length) return
  rt.services.residencySets.holdCover(cover, true)
  rt.run.gate.resourcesChanged()
}
