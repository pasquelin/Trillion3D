// The proxy's rays read the culling's worlds and placement tree where they lie (`gpu/dag/worldTable.ts`,
// `gpu/dag/treeTable.ts`): on the GPU, the shipped walk over the record tables and the walk of before, over the
// worlds and the tree the proxy's buffer mirrored, answer every ray with the same placement, triangle, found or
// not, work and tests, and its distance within `DISTANCE_ULPS`, on generated fields with and without a
// placement tree, blended copies among them. And a world past
// one storage binding keeps its proxy and its camera cut: once refused past the device's limits, its rays now
// meet every placement, hit for hit those of the same world held whole.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/proxy-tables.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { HIT_WORDS } from './proxyWalks.ts'

const page = async () =>
  (await loadPage(
    resolve(import.meta.dirname, 'proxyTablesPage.ts'),
    'proxyTables',
  )) as typeof import('./proxyTablesPage.ts')

/** Units in the last place two walks' distances may differ by. The walk of before and the record walk
 *  read the same words and reach the same hit, but the compiler fuses the two programs' multiply-adds
 *  (the placed ray, the world box) differently around their different loads: the distance's last bits
 *  move, measured at 1 to 2 ULPs, the placement, triangle, found, work and tests never. */
const DISTANCE_ULPS = 2

/** The rays whose words differ, by rank: every word exactly, the distance's bits (word 0, a distance
 *  never negative) within `ulps`. */
const differing = (a: readonly number[], b: readonly number[], ulps = 0) => {
  const rays: number[] = []
  for (let r = 0; r * HIT_WORDS < a.length; r++)
    for (let k = 0; k < HIT_WORDS; k++) {
      const x = a[r * HIT_WORDS + k],
        y = b[r * HIT_WORDS + k]
      if (k === 0 ? Math.abs(x - y) > ulps : x !== y) {
        rays.push(r)
        break
      }
    }
  return rays
}
/** The rays that found a surface. */
const found = (hits: readonly number[]) =>
  Array.from({ length: hits.length / HIT_WORDS }, (_, r) => r).filter(
    (r) => hits[r * HIT_WORDS + 3] === 1,
  )

for (const [count, seed] of [
  [9, 3],
  [150, 11],
  [1200, 29],
] as const)
  test(
    `${count} placements: the walk over the record tables answers as the walk of before, word for word`,
    {
      timeout: 300_000,
    },
    async () => {
      const { compareWalks } = await page()
      const result = await runOnDawn(compareWalks, { count, seed, rayCount: 4096 })
      const { now, before, errors, tree, echo } = result
      console.log(
        JSON.stringify({ count, tree, hits: found(now).length, rays: now.length / HIT_WORDS }),
      )
      assert.deepEqual(errors, [])
      assert.deepEqual(echo, [], 'the table holds the records the host wrote, word for word')
      assert.equal(now.length, before.length)
      assert.ok(found(now).length > 100, 'the rays meet the cubes')
      assert.deepEqual(differing(now, before, DISTANCE_ULPS), [], 'no ray answers otherwise')
    },
  )

test(
  'a world past one storage binding keeps its proxy rays, those of the world held whole',
  {
    timeout: 300_000,
  },
  async () => {
    const { splitWorld } = await page()
    const { whole, split, errors, past } = await runOnDawn(splitWorld, {
      count: 1000,
      rayCount: 4096,
    })
    console.log(JSON.stringify({ past, refused: split.refused }))
    assert.deepEqual(errors, [])
    assert.equal(whole.refused, undefined)
    assert.equal(split.refused, undefined, 'the camera cut past the device limits is made')
    const hits = split.hits!
    assert.deepEqual(differing(hits, whole.hits!), [], 'every ray answers as over the whole world')
    assert.ok(
      found(hits).some((r) => hits[r * HIT_WORDS + 1] >= past),
      'a ray meets a placement past the binding',
    )
  },
)
