// The prefiltered distant shadow's border and merge down (`filterableWgsl.ts`), run as the shipped
// text: a page's border texels copied from the next page's edge, or from its own where none is
// mapped; each texel multiplied by the coarser levels' bilinear reads, from its own value or from 1.
// `runTile` finds the coarser levels' pages with every thread of the tile, as the runtime's barrier
// orders them before the stores.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_PAGE_TEXELS } from './constants.ts'
import { filterableWorld } from './filterableWorld.fixture.ts'

const SIDE = VSM_PAGE_TEXELS
const LAST = SIDE + 1

/** A byte of a page's texel (x, y), border included, that no two texels of two pages share. */
const pattern = (page: number, x: number, y: number) => (page * 37 + x * 3 + y * 5) % 251

/** Page 0 at (64, 64) of map 0, the pages at its left (63, 64) and its lower right (65, 65) mapped, the
 *  rest not, every interior texel of the three patterned. */
function borderWorld(pool: 'vsmFilterableSeparate' | 'vsmFilterableMerged') {
  const w = filterableWorld()
  w.addMap(0)
  w.addPage(0, 0, [64, 64], { secondary: true })
  w.addPage(1, 0, [63, 64], { secondary: true })
  w.addPage(2, 0, [65, 65], { secondary: true })
  w.list('separable', [0])
  for (const page of [0, 1, 2])
    for (let y = 1; y <= SIDE; y++)
      for (let x = 1; x <= SIDE; x++) w.setByte(w.world[pool], page, x, y, pattern(page, x, y))
  const name = pool === 'vsmFilterableMerged' ? 'filterableBorderMerged' : 'filterableBorder'
  for (let lane = 0; lane < SIDE; lane++) w.run(name, lane, [0, 0, 0], [1, 1, 1])
  return (x: number, y: number) => w.getByte(w.world[pool], 0, x, y)
}

for (const pool of ['vsmFilterableSeparate', 'vsmFilterableMerged'] as const)
  test(`the border of the ${pool === 'vsmFilterableMerged' ? 'merged' : 'separate'} pool: the next page’s edge across, the page’s own where none is mapped`, () => {
    const at = borderWorld(pool)
    for (let i = 1; i <= SIDE; i++) {
      // Left: the page at (63, 64) is mapped, its last column across.
      assert.equal(at(0, i), pattern(1, SIDE, i), `left ${i}`)
      // Right, top and bottom: none mapped, the page's own edge row or column.
      assert.equal(at(LAST, i), pattern(0, SIDE, i), `right ${i}`)
      assert.equal(at(i, 0), pattern(0, i, 1), `top ${i}`)
      assert.equal(at(i, LAST), pattern(0, i, SIDE), `bottom ${i}`)
    }
    // The corners: the diagonal page (65, 65) is mapped at the lower right alone.
    assert.equal(at(LAST, LAST), pattern(2, 1, 1))
    assert.equal(at(0, 0), pattern(0, 1, 1))
    assert.equal(at(LAST, 0), pattern(0, SIDE, 1))
    assert.equal(at(0, LAST), pattern(0, 1, SIDE))
    // The interior is as it was.
    assert.equal(at(5, 9), pattern(0, 5, 9))
  })

/** A clipmap of three levels, the maps 0 to 2: level 0's page 0 at (64, 64), level 1's page 1 at (32, 32)
 *  (the finer level's texel (x, y) is the coarser one's (x / 2, y / 2) less the corner steps' offset),
 *  level 2's page 2 at (16, 16). A page is `written` (its dynamic layer drawn into) or as cleared. */
function mergeWorld(
  written: [boolean, boolean, boolean],
  corner1: [number, number] = [0, 0],
  page1: [number, number] = [32, 32],
) {
  const w = filterableWorld()
  w.addMap(0, { levelsLeft: 3 })
  w.addMap(1, { levelsLeft: 2, cornerSteps: corner1 })
  w.addMap(2, { levelsLeft: 1 })
  w.addPage(0, 0, [64, 64], { secondary: true, written: written[0] })
  w.addPage(1, 1, page1, { secondary: true, written: written[1] })
  w.addPage(2, 2, [16, 16], { secondary: true, written: written[2] })
  w.list('filterable', [0])
  return w
}

/** The pages' separable values: page `page` all `value`, border included; or a ramp of x. */
function fill(w: ReturnType<typeof mergeWorld>, page: number, value: number | 'ramp') {
  for (let y = 0; y < SIDE + 2; y++)
    for (let x = 0; x < SIDE + 2; x++)
      w.setByte(w.world.vsmFilterableSeparate, page, x, y, value === 'ramp' ? x : value)
}

/** The tile 0 of the page 0 merged down: the byte of its texel (x, y) of the merged pool. */
function merged(w: ReturnType<typeof mergeWorld>) {
  w.runTile([0, 0, 0], [16, 1, 1])
  return (x: number, y: number) => w.getByte(w.world.vsmFilterableMerged, 0, x + 1, y + 1)
}

/** The ramp of level 1 as the texel `lx` of the page 0 reads it: the position less a half. */
const rampAt = (lx: number, corner = 0) => Math.round(1 + corner + (lx + 0.5) / 2 - 0.5)

test('the merge down: from 1 where the page’s dynamic layer is as cleared, times the written coarser level read bilinear', () => {
  const w = mergeWorld([false, true, false])
  fill(w, 1, 'ramp')
  fill(w, 2, 0)
  const out = merged(w)
  // The texel lx of the page reads level 1 at (lx + ½) / 2 in its page, a texel on for the border; a
  // ramp of bytes is its position less a half. Level 2 is as cleared: skipped, its zeros unused.
  for (const lx of [0, 1, 7, 16, 31]) assert.equal(out(lx, 3), rampAt(lx), `texel ${lx}`)
})

test('the coarser level’s corner steps move the read by a quarter of the map’s texels (4096, 32 pages) a step, halved at each level', () => {
  // Level 1's page that covers the page (64, 64) of level 0 is, with a corner step of one in x, 32 pages along: (64, 32).
  const w = mergeWorld([false, true, false], [1, 0], [64, 32])
  fill(w, 1, 'ramp')
  const out = merged(w)
  for (const lx of [0, 5, 20]) assert.equal(out(lx, 9), rampAt(lx), `texel ${lx}`)
})

test('a page written starts at its own value; a coarser page as cleared adds nothing, a written one multiplies', () => {
  const own = 200
  const w = mergeWorld([true, true, false])
  fill(w, 0, own)
  fill(w, 1, 128)
  fill(w, 2, 0)
  // Its own 200 times level 1's 128, quantized after the product; level 2's zeros are not multiplied in.
  assert.equal(merged(w)(5, 6), Math.round((own / 255) * (128 / 255) * 255))
  // Written, level 2 multiplies the shade away.
  const dark = mergeWorld([true, true, true])
  fill(dark, 0, own)
  fill(dark, 1, 255)
  fill(dark, 2, 0)
  assert.equal(merged(dark)(5, 6), 0)
})

test('a level whose page is not mapped, or only a fallback, adds nothing', () => {
  const { consts } = filterableWorld()
  const fallback = consts.VSM_ENTRY_MAPPED_BIT + (1 << consts.VSM_ENTRY_COARSER_SHIFT) + 2
  for (const entry of [0, fallback]) {
    const w = mergeWorld([false, true, true])
    // Level 1's entry is none, or points at a coarser level's page; level 2 is written and multiplies.
    w.world.vsmPageTable[32 * 512 + 128 + 32] = entry
    fill(w, 1, 0)
    fill(w, 2, 10)
    assert.equal(merged(w)(5, 6), 10, `entry ${entry}`)
  }
})
