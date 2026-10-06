// The engine's GPU draw compaction feeds the visibility raster in the same submission: on six
// cases — rows in every bin over three workgroups, a selection mask that filters some or all,
// sparse and empty frames after full ones, and an overflow — the instance permutation and the
// indirect commands equal the CPU model's (`evaluateDrawCompact`), and each slot's draw shows
// exactly its rows' pages, read through slot starts that sit in storage, not in the command
// (`drawCompactionPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { BASE_SLOTS, HALF_SLOTS } from '../../../packages/sdk-browser/src/gpu/draw/draw.ts'
import {
  evaluateDrawCompact,
  indirectForDraw,
  type DrawItem,
} from '../../../packages/sdk-browser/src/gpu/draw/cpu.fixture.ts'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import type { DrawCase } from './drawCase.ts'
import { DIRECT_PAGE } from './drawVisibility.ts'

const CAP = 192
// Canonical page indices that differ from both input and compacted positions.
const items: DrawItem[] = Array.from({ length: 130 }, (_, i) => ({
  pageIndex: 17 + ((i * 37) % 130),
  // Every bin: the three face modes and their cutout bins.
  bin: (i * 7) % HALF_SLOTS,
  rest: ((i * 11) % 2) as 0 | 1,
  selectionIndex: i,
}))
const CASES: DrawCase[] = [
  { name: 'mixed slots across three workgroups', items },
  {
    name: 'a selection mask filters before the scatter',
    items,
    mask: Array.from({ length: CAP }, (_, i) => (i % 4 < 2 ? 1 : 0)),
  },
  { name: 'a selection mask rejects every page', items, mask: Array<number>(CAP).fill(0) },
  {
    name: 'sparse slots replace what was there',
    items: items.filter((item) => item.bin === 1).slice(0, 7),
  },
  { name: 'an empty frame replaces what was there', items: [] },
  {
    name: 'an overflow emits no draw',
    items: Array.from({ length: CAP + 1 }, (_, i) => items[i % items.length]),
  },
]
const selected = ({ items, mask }: DrawCase) =>
  mask ? items.filter((item) => mask[item.selectionIndex!] !== 0) : items

test('the GPU compaction feeds the visibility raster the CPU model’s draws', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'drawCompactionPage.ts'),
    'drawCompaction',
  )) as typeof import('./drawCompactionPage.ts')
  const { adapter, features, alignment, results, errors } = await runOnDawn(
    page.runDrawCompaction,
    {
      cases: CASES,
      cap: CAP,
    },
  )
  console.log(
    JSON.stringify({
      adapter,
      cases: results.map(({ name, visiblePages }) => ({
        name,
        slotPages: visiblePages.slice(0, BASE_SLOTS).map((pages) => pages.length),
      })),
    }),
  )
  assert.deepEqual(errors, [])
  assert.ok(!features.includes('indirect-first-instance'), 'slot starts must come from storage')
  const models = CASES.map((sample) => evaluateDrawCompact(selected(sample), 3, CAP))
  // The case exercises slot starts no storage binding offset could express.
  assert.ok(
    BASE_SLOTS > 0 &&
      [...Array(BASE_SLOTS).keys()].some(
        (s) => (models[0].indirect[s * 4 + 3] * 4) % alignment !== 0,
      ),
    'a slot start must fall off the storage offset alignment',
  )
  for (const [k, { name, instanceIds, commands, visiblePages }] of results.entries()) {
    const model = models[k]
    assert.deepEqual(instanceIds, [...model.instances], `${name}: the instance permutation`)
    assert.deepEqual(commands, [...indirectForDraw(model)], `${name}: the indirect commands`)
    for (let slot = 0; slot < BASE_SLOTS; slot++) {
      const pages = model.overflow
        ? []
        : selected(CASES[k])
            .filter((item) => item.rest * HALF_SLOTS + item.bin === slot)
            .map((item) => item.pageIndex)
            .sort((a, b) => a - b)
      assert.deepEqual(visiblePages[slot], pages, `${name}: slot ${slot} draws its rows' pages`)
    }
    assert.deepEqual(visiblePages[BASE_SLOTS], [DIRECT_PAGE], `${name}: the direct draw's page`)
  }
})
