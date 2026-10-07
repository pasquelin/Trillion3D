// ONE page record per primitive. All placements of a primitive share its `pages`
// array and dependencies, so the load heap does not grow with the number of placements, and a
// record carries no world, row, winding or packed rank of its own — its root does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placedSession } from './webgpuGrowth.fixture.ts'

test('a page record carries no world, row, winding, placement or packed rank: its root does', async () => {
  const session = await placedSession(5)
  try {
    const { allPages, collectedRoots, metadata } = session
    // The open's records equal the primitives' pages (3 at the fixture's 3 one-page primitives),
    // whatever the rows later grow to.
    const primitivePages = metadata.primitives.reduce(
      (n, primitive) => n + primitive.pages.length,
      0,
    )
    assert.equal(
      allPages.length,
      primitivePages,
      'one record per primitive page, not per placement',
    )
    // Every placement of a primitive shares its one `pages` array: one distinct array per primitive.
    assert.equal(
      new Set(collectedRoots.map((root) => root.pages)).size,
      metadata.primitives.length,
      'the placements of a primitive share their pages array',
    )
    for (const page of allPages)
      for (const field of [
        'matrix',
        'placement',
        'windingCw',
        'windingEpoch',
        'placementIndex',
        'packedIndex',
      ])
        assert.ok(!(field in page), `${page.url} carries no ${field}`)
  } finally {
    session.dispose()
  }
})
