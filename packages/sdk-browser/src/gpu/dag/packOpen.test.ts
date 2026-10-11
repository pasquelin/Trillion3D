// Packing a world at open costs the primitives, not the placements: a page array placed again on the
// records it already has writes no record, counts no root cluster and names no content key again;
// the residency bits with nothing resident come from the shared blank state; the pages read and
// the records packed are the same words an unshared packing of every placement gives.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { packDagSelection } from './pack.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
import { createDagReadiness } from './readiness.ts'
import { createDagPoolList } from './poolList.ts'

type Reads = { sphere: number; url: number; parentError: number }

/** `pages` with every read of the fields a packing walks counted. */
function counted(pages: ReturnType<typeof scenePages>, reads: Reads) {
  return pages.map((page) => {
    const rec = { ...page }
    for (const field of ['sphere', 'url', 'parentError'] as const) {
      const value = page[field]
      Object.defineProperty(rec, field, {
        get() {
          reads[field]++
          return value
        },
      })
    }
    return rec
  })
}

/** `placements` poses over `primitives` page arrays, each array its own pyramid. */
function world(placements: number, primitives: number, reads: Reads) {
  const arrays = Array.from({ length: primitives }, (_, u) =>
    counted(scenePages(64 + 16 * u, 4), reads),
  )
  // The placements of a primitive share its pages and its hierarchy, as a manifest gives them.
  const templates = arrays.map((pages) => sceneRoots(pages, [new G.Matrix4()], true)[0])
  return Array.from({ length: placements }, (_, w) => ({
    ...templates[w % primitives],
    world: new G.Matrix4().makeTranslation(w, 0, 0),
  }))
}

test('the page reads of a packing follow the primitives, not the placements', () => {
  const few: Reads = { sphere: 0, url: 0, parentError: 0 },
    many: Reads = { sphere: 0, url: 0, parentError: 0 }
  packDagSelection(world(12, 3, few))
  packDagSelection(world(600, 3, many))
  assert.ok(few.sphere > 0 && few.url > 0 && few.parentError > 0)
  assert.deepEqual(many, few)
})

test('a placement of a page array packed before shares its records, keys and root clusters', () => {
  const reads: Reads = { sphere: 0, url: 0, parentError: 0 }
  const roots = world(30, 3, reads)
  const packed = packDagSelection(roots)
  const [first] = [0, 1, 2].map((u) => packDagSelection([roots[u]]))
  assert.ok(first.recordCount > 0)
  assert.equal(
    packed.recordCount,
    [0, 1, 2].reduce((n, u) => n + packDagSelection([roots[u]]).recordCount, 0),
  )
  const per = [0, 1, 2].map((u) => packDagSelection([roots[u]]).rootCount)
  assert.equal(
    packed.rootCount,
    roots.reduce((n, _, w) => n + per[w % 3], 0),
  )
})

test('the blank residency of a placement is the pages its shared state reads ready', () => {
  const roots = world(9, 3, { sphere: 0, url: 0, parentError: 0 })
  const packed = packDagSelection(roots)
  const readiness = createDagReadiness(packed)
  packed.cutLinks.forEach(({ pageBase, pageCount }, w) => {
    const { ready, child } = readiness.blankPages(w)
    const expected = (test: (page: number) => boolean) =>
      Array.from({ length: pageCount }, (_, p) => p).filter((p) => test(pageBase + p))
    assert.deepEqual(ready, expected(readiness.isReady))
    assert.deepEqual(child, expected(readiness.isChildReady))
  })
})

test('a cut made beside a pool lists its held pages by asking the keys, never every instance', () => {
  const roots = world(60, 3, { sphere: 0, url: 0, parentError: 0 })
  const packed = packDagSelection(roots)
  const asked: number[] = []
  const device = { queue: { writeBuffer() {} } } as unknown as GPUDevice
  const parts = { buffers: [{} as GPUBuffer], bytes: Number.MAX_SAFE_INTEGER }
  const list = createDagPoolList(device, packed, parts, (page) => (asked.push(page), true))
  assert.ok(asked.length <= packed.keyCount, `${asked.length} asked for ${packed.keyCount} keys`)
  assert.ok(asked.length < packed.pageCount / 10)
  assert.equal(
    list.entries.size,
    packed.keyCount,
    'every key is listed once, at its canonical page',
  )
})
