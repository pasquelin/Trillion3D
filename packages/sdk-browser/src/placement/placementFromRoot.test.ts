// A page record carries no placement values. Every reader takes the world and the winding from the
// root that places it, so a placement is never copied into each of its pages: a cluster the cut
// lists visible is decoded in the frame it is drawn, its world the one of the root its placement
// names (`visibility/decode/`).
// The cut publishes its instances as packed catalogue ranks, and the consumers read
// a record back through the one accessor, `recordOf`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGE_INFO } from '../visibility/pageInfo.ts'
import { GROWN_ROWS, placedSession, scaleDown } from './growth/webgpuGrowth.fixture.ts'
import { rootOf } from '../geometry/selection/placements.ts'
import { visibleClusters } from '../../../../tests/kit/fakeDevice/globals.ts'
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'

type Session = Awaited<ReturnType<typeof placedSession>>

/** A copy of what a buffer of the mocked device holds: what a pass that binds it reads. */
const heldBytes = (buffer: GPUBuffer) =>
  (buffer as unknown as { data: Uint8Array }).data.slice().buffer

/**
 * What the image draws: each cluster the cut lists visible, with what the decode wrote of it in the
 * decoded clusters (`rt.vis.pageTable`) — its world, as the single-precision words the raster
 * reads, the offset of its page in the pool, in words — and the world of the root its placement
 * names.
 */
function decoded({ rt }: Session) {
  const table = heldBytes(rt.vis.pageTable!),
    ints = new Uint32Array(table),
    floats = new Float32Array(table),
    at = PAGE_INFO.at
  return visibleClusters(rt.run.gpuSelection!.visible as unknown as { data: Uint8Array }).map(
    ({ index, page, placement }) => {
      const row = index * PAGE_INFO.words
      return {
        page,
        placement,
        world: Array.from(floats.subarray(row + at.world, row + at.world + MATRIX_VALUES)),
        expected: Array.from(
          Float32Array.from(rootOf(rt.layout.selectionRoots, placement).world.elements),
        ),
        offset: ints[row + at.pageOffset],
        home: rt.layout.clusters.offsetOf(page),
      }
    },
  )
}

/** The session at open, once its core node moved every placement under it, once grown: what
 *  `look` reads of each. */
async function steps<T>(look: (session: Session) => T) {
  const session = await placedSession(GROWN_ROWS)
  const { core, cells, io, draw } = session
  try {
    const seen = [look(session)]
    core.position.set(0.5, 10, -0.25)
    core.rotation.set(0, 0.3, 0)
    for (let frame = 0; frame < 2; frame++) cells.frame([0, 0, 0], io, noBudget)
    await draw()
    await draw()
    seen.push(look(session))
    await scaleDown(session)
    // The pages of the new placements arrive, the cut over them lists them.
    for (let frame = 0; frame < 4; frame++) await draw()
    seen.push(look(session))
    return seen
  } finally {
    session.dispose()
  }
}
const noBudget = { admits: () => true, spend() {} }

test('each decoded cluster carries the world of the root that places it, whatever the placement moved', async () => {
  const seen = await steps(decoded)
  // Ground, then the two leaves' two placements each; grown in place, the two new placements.
  assert.deepEqual(
    seen.map((clusters) => clusters.length),
    [5, 5, 7],
  )
  for (const [step, clusters] of seen.entries())
    for (const { page, placement, world, expected } of clusters)
      assert.deepEqual(
        world,
        expected,
        `${['at open', 'moved', 'grown'][step]}, page ${page}, root ${placement}`,
      )
  // The core node moved every placement under it: the leaves' worlds are not those of the open.
  const worlds = (step: number) => seen[step].map(({ world }) => world.join())
  assert.notDeepEqual(
    worlds(1).toSorted(),
    worlds(0).toSorted(),
    'the moved placements are decoded moved',
  )
})

// Ground, then the two leaves' two placements each, at the homes of `pageHomes`: each page at its
// own width, in the catalogue's order — twelve bytes a triangle, three words.
test('each decoded cluster names its page at the home the pool gave it, whatever the placement moved', async () => {
  const [at, moved, grown] = (await steps(decoded)).map((clusters) => {
    for (const { page, offset, home } of clusters)
      assert.equal(offset, home, `page ${page} is decoded at the home the pool holds for it`)
    return clusters.map(({ offset }) => offset).sort((a, b) => a - b)
  })
  assert.deepEqual(at, [0, 3, 3, 6, 6])
  // The grown rows' two new placements, one of each leaf, at their leaf's home.
  assert.deepEqual([moved, grown], [at, [0, 3, 3, 3, 6, 6, 6]])
})
