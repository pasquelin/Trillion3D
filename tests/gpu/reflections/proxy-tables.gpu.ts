// The proxy's rays read the culling's worlds and placement tree where they lie (`gpu/dag/worldTable.ts`,
// `gpu/dag/treeTable.ts`): on the GPU, the shipped walk over the record tables and the walk of before, over the
// worlds and the tree the proxy's buffer mirrored, answer every ray with the same words — its distance's bits, its placement, its triangle, found or not, its work and its
// tests —, on generated fields with and without a placement tree, blended copies among them. And a world the
// culling splits in ranges keeps its proxy: once refused past one storage binding, its rays now meet the
// placements of every range, hit for hit those of the same world held whole.
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

/** The rays whose words differ, by rank. */
const differing = (a: readonly number[], b: readonly number[]) => {
  const rays: number[] = []
  for (let r = 0; r * HIT_WORDS < a.length; r++)
    for (let k = 0; k < HIT_WORDS; k++)
      if (a[r * HIT_WORDS + k] !== b[r * HIT_WORDS + k]) {
        rays.push(r)
        break
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
      const { now, before, errors, tree } = result
      console.log(
        JSON.stringify({ count, tree, hits: found(now).length, rays: now.length / HIT_WORDS }),
      )
      assert.deepEqual(errors, [])
      assert.equal(now.length, before.length)
      assert.ok(found(now).length > 100, 'the rays meet the cubes')
      assert.deepEqual(differing(now, before), [], 'no ray answers otherwise')
    },
  )

test(
  'a world the culling splits in ranges keeps its proxy rays, those of the world held whole',
  {
    timeout: 300_000,
  },
  async () => {
    const { splitWorld } = await page()
    const { whole, split, errors } = await runOnDawn(splitWorld, { count: 1000, rayCount: 4096 })
    console.log(
      JSON.stringify({ whole: whole.ranges, split: split.ranges, refused: split.refused }),
    )
    assert.deepEqual(errors, [])
    assert.equal(whole.refused, undefined)
    assert.equal(split.refused, undefined, 'the proxy of a split world is made')
    assert.deepEqual(whole.ranges, [1000])
    assert.equal(split.ranges?.length, 2, 'the culling splits its frames')
    const hits = split.hits!
    assert.deepEqual(differing(hits, whole.hits!), [], 'every ray answers as over the whole world')
    const firstRange = split.ranges![0]
    assert.ok(
      found(hits).some((r) => hits[r * HIT_WORDS + 1] >= firstRange),
      'a ray meets a placement of the second range',
    )
  },
)
