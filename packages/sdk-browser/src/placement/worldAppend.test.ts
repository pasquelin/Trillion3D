// A source added to a running session costs what it adds, never what the world holds: the words
// written to the GPU while meshes of a held geometry wearing another material join (`addPlacements`,
// the growth's adoption) follow the placements and the primitives added — page-table rows, worlds,
// frames, cones, nodes —, on a world of a thousand placements as on one of two hundred and fifty
// thousand, and nothing opens the session again: the cut that drew the world draws it still, joined
// in the room it kept. The one cut made over the world at the first growth (`grownCutCapacity`) and
// the tables grown ahead (`rowsAhead`) are the O(N) a world pays O(log N) times, counted apart.
import test from 'node:test'
import assert from 'node:assert/strict'
import { primitive, session } from './appendSession.fixture.ts'

/** What joining sources of `counts` placements, one after the other, costs a world of `placements`;
 *  the first join, which makes the cut over the world at a grown capacity, apart. */
async function costs(placements: number, counts: readonly number[]) {
  const world = await session(placements)
  try {
    const first = await world.join(1)
    assert.equal(first.refused, undefined)
    const steady = []
    for (const count of counts) {
      const joined = await world.join(count)
      assert.equal(joined.refused, undefined, 'taken, never refused')
      assert.ok(joined.same, 'the cut that drew the world draws it still: nothing opened again')
      steady.push(joined.bytes)
    }
    return { first: first.bytes, steady }
  } finally {
    world.dispose()
  }
}

const COUNTS = [1, 100, 500]

test('the words a source writes to join follow its placements, on a world of 1k as of 250k', async () => {
  const small = await costs(1_000, COUNTS)
  const large = await costs(250_000, COUNTS)
  COUNTS.forEach((count, at) => {
    // What it adds: a few hundred bytes a placement (worlds, frames, cones, table rows), and the
    // uniforms and headers every join writes, the same on any world.
    assert.ok(
      large.steady[at] <= 512 * count + 64 * 1024,
      `${count} placements: ${large.steady[at]}`,
    )
    assert.ok(
      Math.abs(large.steady[at] - small.steady[at]) <= 1024 + 0.1 * small.steady[at],
      `${count} placements cost ${small.steady[at]} bytes on 1k and ${large.steady[at]} on 250k`,
    )
  })
  // The first growth is the O(N) the world pays once: it makes the cut over every root.
  assert.ok(large.first > 50 * small.first, 'the first growth packs the world again')
})

test('ten thousand placements cost a hundred times what a hundred do, on the largest world', async () => {
  const { steady } = await costs(250_000, [100, 10_000])
  const [few, many] = steady
  assert.ok(many > 30 * few && many < 200 * few, `${few} bytes for 100, ${many} for 10000`)
})

test('a primitive the session does not hold joins in the room the cut kept, whatever the world', async () => {
  const ranks = (mesh: number) => primitive(mesh, 'other')
  const cost = async (placements: number) => {
    const world = await session(placements)
    try {
      assert.equal((await world.join(1)).refused, undefined)
      const brought = []
      for (const mesh of [8, 9, 10, 11]) {
        const joined = await world.join(1, ranks(mesh))
        assert.equal(joined.refused, undefined)
        assert.ok(joined.same, 'no cut made over the world for a primitive it has room for')
        brought.push(joined.bytes)
      }
      return brought
    } finally {
      world.dispose()
    }
  }
  const [small, large] = [await cost(1_000), await cost(250_000)]
  small.forEach((bytes, at) =>
    assert.ok(
      Math.abs(large[at] - bytes) <= 1024 + 0.1 * bytes,
      `${at}: ${bytes} against ${large[at]}`,
    ),
  )
})
