// Random cuts through every way a readback lands: adopted, overwritten before it was, voided by a
// moved residency, cut past its list and grown, or never copied from a dropped command buffer. The
// publication is the hashed difference's at every adoption (`readbackChain.fixture.ts`). The
// lookups are counted against a model of the chain (`../../gpu/dag/differenceChain.ts`): the host
// follows the changes the GPU took against the list it held, so it looks up the pages that entered
// since that list alone — every page of both lists at its first adoption, when it held no GPU
// list. Exactly, without repeats or pages lacking a record; with them, at most once more for each.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountReadbackChain, settle } from './readbackChain.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import type { GpuCut } from '../../gpu/core/selection.ts'

/** The lists the host holds, whether they are a GPU snapshot the changes are taken against, and
 *  whether a list's changes since did not fit the words a readback carries them in. */
function chainModel() {
  let held: [Set<number>, Set<number>] = [new Set(), new Set()],
    kept: [Set<number>, Set<number>] = [new Set(), new Set()],
    snapshot = false
  const since = [false, false],
    whole = [false, false]
  return {
    /** A copy of `lists`, cut on `cap` ranks, landed. */
    landed(lists: [number[], number[]], cap: number, adoptable: boolean) {
      for (const l of [0, 1]) {
        const now = new Set(lists[l]),
          entered = lists[l].filter((page) => !kept[l].has(page)).length,
          exited = [...kept[l]].filter((page) => !now.has(page)).length
        since[l] ||= entered + exited > cap
        if (adoptable) [whole[l], since[l]] = [whole[l] || since[l], false]
      }
      kept = [new Set(lists[0]), new Set(lists[1])]
    },
    /** The lookups adopting the readback in hand takes, `lists` its lists. */
    adopted(lists: [number[], number[]]) {
      const lookups = [0, 1].reduce((sum, l) => {
        if (!snapshot || whole[l]) return sum + lists[l].length
        return sum + new Set(lists[l].filter((page) => !held[l].has(page))).size
      }, 0)
      held = [new Set(lists[0]), new Set(lists[1])]
      snapshot = true
      whole.fill(false)
      return lookups
    },
  }
}

const STEPS = 160
/** Pages of the catalogue a messy run keeps records for, of the 260 its cuts name. */
const MESSY_RECORDS = 200
const repeats = (list: number[]) => new Set(list.filter((page, i) => list.indexOf(page) !== i))

/** Random frames on a list of 48 ranks; `messy` adds repeats and pages without a record. */
async function run(seed: number, messy: boolean) {
  const next = random(seed),
    m = await mountReadbackChain(48, messy ? MESSY_RECORDS : 300),
    model = chainModel()
  /** Pages the asked lists repeat since the one adopted, that one included. */
  let repeated = new Set<number>()
  const pick = (count: number) => Array.from({ length: count }, () => Math.floor(next() * 260))
  let pages = [...new Set(pick(30))],
    inHand: GpuCut | null = null,
    adopted: GpuCut | null = null
  m.hold(pick(6))
  for (let step = 0; step < STEPS; step++) {
    // Most pages stay, a few leave and enter; now and then a reorder or a cut past the list.
    pages = [...new Set([...pages.filter(() => next() < 0.85), ...pick(Math.floor(next() * 8))])]
    if (next() < 0.3) pages.sort((a, b) => a - b)
    const drawn = next() < 0.05 ? [...new Set([...pages, ...pick(70)])] : pages.slice()
    const asked = messy && next() < 0.2 ? [...drawn, ...drawn.slice(0, 2)] : drawn.slice().reverse()
    const roll = next(),
      cap = m.rig.resources.listCap,
      copies = m.rig.copies()
    if (roll < 0.05) {
      m.send({ asked, drawn }, m.rig.resources.device.createCommandEncoder())?.(false)
      continue
    }
    m.send({ asked, drawn })
    if (roll < 0.15) m.rig.selection.markWorld(0, step & 1)
    await settle()
    const cut = m.rig.selection.peek()
    if (m.rig.copies() > copies) {
      model.landed([asked.slice(0, cap), drawn.slice(0, cap)], cap, !!cut && cut !== inHand)
      inHand = cut
      for (const page of repeats(asked.slice(0, cap))) repeated.add(page)
    }
    if (next() < 0.4) continue
    const lookups = m.adopt()
    if (!cut || cut === adopted) continue
    const lists: [number[], number[]] = [cut.result.pageIds, cut.result.drawablePageIds!],
      expected = model.adopted(lists)
    if (!messy) assert.equal(lookups, expected)
    else {
      const unrecorded = [...lists[0], ...lists[1]].filter((page) => page >= MESSY_RECORDS)
      assert.ok(lookups <= expected + unrecorded.length + 2 * repeated.size, `step ${step}`)
    }
    repeated = repeats(lists[0])
    adopted = cut
  }
}

test('random cuts look up exactly the pages that entered, and publish the same', async () => {
  for (const seed of [1, 7, 831]) await run(seed, false)
})

test('random cuts with repeats and pages without a record publish the same, never hashed', async () => {
  for (const seed of [2, 9, 64]) await run(seed, true)
})
