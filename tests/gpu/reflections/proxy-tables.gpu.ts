// The proxy's rays read the culling's worlds and placement tree where they lie (`gpu/dag/worldTable.ts`,
// `gpu/dag/treeTable.ts`): a world past one storage binding keeps its proxy and its camera cut — once
// refused past the device's limits, its rays now meet every placement, hit for hit those of the same
// world held whole.
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

/** The rays whose words differ, by rank: every word exactly. */
const differing = (a: readonly number[], b: readonly number[]) => {
  const rays: number[] = []
  for (let r = 0; r * HIT_WORDS < a.length; r++)
    for (let k = 0; k < HIT_WORDS; k++) {
      if (a[r * HIT_WORDS + k] !== b[r * HIT_WORDS + k]) {
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
