// Pages joining a catalogue the session holds: what the open's tables take follows the pages added,
// never the pages held — counted on a catalogue of 100, then of 20 000 primitives.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageRec, ClusterRoot } from '../../../page/selection/types.ts'
import { createWebgpuPageTracking } from '../../row/pageTracking.ts'
import { describePageSlots } from '../../row/pageSlots.ts'
import { indexPageRequests, RequestStamps } from '../../../page/selection/requests.ts'
import { createHostRankDelta } from '../../../streaming/hostRanks.ts'
import { rootCoverOf } from './rootCover.ts'
import { catalogueRefusal, growCatalogue } from './catalogueGrowth.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

const PER = 3
/** A primitive of `PER` pages, each with its geometry page; `at` makes the addresses its own. */
function primitive(at: number): PageRec[] {
  return Array.from(
    { length: PER },
    (_, k) =>
      ({
        url: `p${at}/${k}`,
        triangles: 100,
        indexBytes: 1200,
        level: 0,
        parentError: null,
        geometryPage: { url: `g${at}/${k}`, bytes: 400 + 4 * k, indexCount: 300 },
      }) as unknown as PageRec,
  )
}
const rootOf = (pages: PageRec[]) => ({ pages }) as unknown as ClusterRoot<PageRec>

/** A catalogue opened on `held` primitives, its map reads counted. */
function session(held: number) {
  const roots = Array.from({ length: held }, (_, i) => rootOf(primitive(i)))
  const allPages = roots.flatMap((root) => root.pages)
  const requests = indexPageRequests(allPages)
  const reads = { count: 0 }
  for (const method of ['get', 'set', 'has'] as const) {
    const original = requests[method].bind(requests) as (...args: unknown[]) => unknown
    ;(requests as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => (
      reads.count++,
      original(...args)
    )
  }
  const requestUrls = [...requests.keys()]
  const tracking = createWebgpuPageTracking(allPages)
  const census = describePageSlots(allPages)
  const cover = rootCoverOf(roots, tracking)
  const setup = {
    ...{ allPages, requests, requestUrls, tracking, census },
    ...cover,
    requestStamps: new RequestStamps(requestUrls.length),
    hostRanks: createHostRankDelta(requestUrls.length, requestUrls),
    byUrl: new Map<string, PageRec[]>(),
    sourceBytes: new Map<string, Uint8Array>(),
    pageBytes: census.pageBytes,
    maxCorners: 384,
    geometryShape: { uniquePages: census.homes.size, homeBytes: 0, rootPages: 0, pageBytes: 0 },
  }
  return { setup, rt: { setup } as unknown as WebgpuPagesRuntime, reads }
}

for (const held of [100, 20_000]) {
  test(`${held} primitives held: the tables take the pages added, and nothing else`, () => {
    const { setup, rt, reads } = session(held)
    const keys = setup.tracking.pageCatalog.length
    for (const added of [1, 100]) {
      const roots = Array.from({ length: added }, (_, i) =>
        rootOf(primitive(1_000_000 + added * 1000 + i)),
      )
      const pages = roots.flatMap((root) => root.pages)
      assert.equal(catalogueRefusal(rt, pages), undefined)
      const before = {
        keys: setup.tracking.pageCatalog.length,
        urls: setup.requestUrls.length,
        floor: setup.floorUrls.size,
        read: reads.count,
      }
      const { grown, cover } = growCatalogue(rt, { allPages: pages, roots })
      assert.equal(setup.tracking.pageCatalog.length - before.keys, added * PER)
      assert.equal(setup.requestUrls.length - before.urls, added * PER)
      assert.equal(setup.floorUrls.size - before.floor, added * PER, 'the cover is the floor')
      assert.equal(cover.length, added * PER)
      assert.equal(grown.widths.size, added * PER)
      assert.equal(reads.count - before.read, 2 * added * PER, 'two reads of the rank map a page')
      assert.equal(setup.bootstrapKey.length, setup.tracking.keyCount, 'the cover table follows')
      assert.equal(setup.hostRanks.hold().urls, setup.requestUrls)
    }
    assert.ok(setup.tracking.pageCatalog.length > keys)
  })
}

test('a page the catalogue cannot hold is refused by name', () => {
  const { rt } = session(2)
  const [wide] = primitive(9)
  ;(wide.geometryPage as { indexCount: number }).indexCount = 4000
  assert.match(catalogueRefusal(rt, [wide])!, /wider than the draw/)
  assert.equal(catalogueRefusal(rt, [primitive(10)[0]]), undefined)
})

test('a page read as floats joins the catalogue by its index bytes, as a quantized one does', () => {
  const { setup, rt } = session(2)
  const pages = primitive(10)
  for (const page of pages) delete (page as { geometryPage?: unknown }).geometryPage
  assert.equal(catalogueRefusal(rt, pages), undefined)
  const { grown } = growCatalogue(rt, { allPages: pages, roots: [rootOf(pages)] })
  assert.equal(grown.widths.size, PER)
  assert.equal(grown.widths.get(pages[0].url), 1200, 'its slot holds its index page')
  assert.equal(setup.census.homes.get(pages[0].url), 1200)
})
