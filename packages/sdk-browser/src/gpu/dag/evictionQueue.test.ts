// The EVICTION QUEUE a resident GPU cut publishes: run on the Node device, which replays the
// stamps, their raise up the groups and `dagListEvictions` through their CPU mirrors
// (`tests/kit/gpu/mockEvict.ts`); the mirrors themselves checked against the cut rule's own
// closure (`../../page/cut/groupClosure.ts`) on generated frames.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { requestScene } from './requestScene.fixture.ts'
import { AHEAD_AGE, KEY_PAGE_BITS, OLD_STEP, ageStep, canonicalPage } from './evict.ts'
import * as L from './layout.ts'
import { aheadClock, listEvictions, pageKeys, raiseGroups } from './evict.fixture.ts'
import { pageResidency } from './readiness.fixture.ts'
import { ruleDag } from '../../page/cut/cutRule.fixture.ts'
import { placements, stripCamera } from '../../page/cut/cutRuleBackends.fixture.ts'
import { postPackedBases } from '../../page/selection/placements.ts'
import { createGroupClosure } from '../../page/cut/groupClosure.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { packedWorldsToRenderOrigin } from './pack.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'

/** The first frame the tests cut at: past the two a use protects, so a page never used is old. */
const START = 10

/** `packed` cut on the Node device, every page resident for the rule; `cut()` cuts at the next
 *  frame and reads back. */
async function residentCutOf(packed: ReturnType<typeof packDagSelection>, uniforms: object) {
  installGpuGlobals()
  const gpu = mockGpu({ packed })
  const selection = await createGpuDagSelection(gpu.device, packed)
  assert.ok(selection)
  selection.updateResidency(pageResidency(new Uint32Array(packed.pageCount).fill(1)))
  const keys = pageKeys(packed),
    words = Uint32Array.from({ length: packed.pageCount }, (_, page) => keys.keyWordOf(page))
  let frame = START
  const cut = async () => {
    selection.dispatch({ ...(uniforms as Parameters<typeof selection.dispatch>[0]), frame })
    frame++
    const result = await selection.flush()
    assert.ok(result?.evictPageIds)
    return { result, queue: [...result.evictPageIds], old: result.evictOld ?? 0 }
  }
  const holdAll = () => {
    for (let page = 0; page < packed.pageCount; page++) selection.notePool(page, true)
  }
  return { gpu, packed, selection, holdAll, keys, words, cut }
}

/** Four placements of one page set without groups, every page resident for the rule. */
async function residentCut(leaves = 256) {
  const scene = requestScene(4, leaves, 4)
  return residentCutOf(scene.packed, scene.uni)
}

/** `copies` placements of the cut-rule DAG — one page array, as a primitive placed many times —,
 *  its groups and the groups replacing them, in a row along -x: the strip camera sees the first. */
function groupedScene(copies = 4, leaves = 64) {
  const dag = ruleDag(leaves)
  const roots = placements(dag, copies, leaves + 8).map((root) => ({
    ...root,
    pages: dag.pages,
  })) as unknown as Parameters<typeof packDagSelection>[0]
  const packed = packDagSelection(roots),
    cam = stripCamera(dag)
  packedWorldsToRenderOrigin(packed, roots, cam.eye)
  const pages = roots.flatMap((root) => root.pages) as unknown as PageRec[]
  const closure = createGroupClosure(roots as never, postPackedBases(roots as never), pages)
  /** Every packed page `ids` close over, by the cut rule's own walk. */
  const closeOver = (ids: readonly number[]) => {
    const held = new Set<number>()
    closure.closeOver(ids, (id) => void held.add(id), undefined, true)
    return held
  }
  return { packed, uniforms: cameraSelectionUniforms(cam, 1, [1280, 720]), closeOver }
}

test('each key once, children before parents, never one the cut read by any placement', async () => {
  const { holdAll, words, cut } = await residentCut()
  const levelOf = (page: number) => words[page] >>> KEY_PAGE_BITS
  holdAll()
  const { result, queue } = await cut()
  assert.ok(queue.length > 10, 'the cut must leave pages to evict')
  assert.equal(new Set(queue).size, queue.length)
  for (const page of queue) assert.equal(canonicalPage(words[page]), page)
  // Never used, every listed key is as old as the others: a coarser page never ahead of a finer one.
  assert.ok(new Set(queue.map(levelOf)).size > 1, 'the queue must span levels')
  for (let i = 1; i < queue.length; i++)
    assert.ok(levelOf(queue[i - 1]) <= levelOf(queue[i]), `a parent leaves before a child at ${i}`)
  const read = [...result.pageIds, ...(result.drawablePageIds ?? [])]
  assert.ok(
    read.some((page) => canonicalPage(words[page]) !== page),
    'a later placement reads',
  )
  for (const page of read) assert.ok(!queue.includes(canonicalPage(words[page])), `${page} listed`)
})

test('a page in use holds its whole group and every group above it, up to the roots', async () => {
  const scene = groupedScene()
  const { holdAll, words, cut } = await residentCutOf(scene.packed, scene.uniforms)
  holdAll()
  const { result, queue } = await cut()
  const read = [...result.pageIds, ...(result.drawablePageIds ?? [])]
  assert.ok(read.length > 4, 'the camera reads pages')
  const held = scene.closeOver(read)
  assert.ok(held.size > new Set(read).size, `${held.size} held for ${new Set(read).size} read`)
  const listed = new Set(queue)
  for (const page of held)
    assert.ok(!listed.has(canonicalPage(words[page])), `${page}, held by a page in use, listed`)
  assert.ok(queue.length > 0, 'what no page in use holds is listed')
})

test('the queue lists what the pool holds, whatever the rule reads, and no more', async () => {
  const { selection, holdAll, cut } = await residentCut()
  // The rule reads every page resident; the pool holds three keys the cut leaves: three listed.
  assert.deepEqual((await cut()).queue, [])
  holdAll()
  const listed = (await cut()).queue
  for (const page of listed.slice(3)) selection.notePool(page, false)
  assert.deepEqual(new Set((await cut()).queue), new Set(listed.slice(0, 3)))
  // The pool gives one back and takes it again: the list follows each move.
  selection.notePool(listed[0], false)
  assert.deepEqual(new Set((await cut()).queue), new Set(listed.slice(1, 3)))
})

test('the mirror ranks older first, then finer first, and skips the pages any view uses', () => {
  // Keys 0..4, canonical pages 0..4: level 1 used at 1, level 0 used at 6, level 0 used at 1,
  // level 0 used now, level 0 used the frame before.
  const keyWords = Uint32Array.from([1 << KEY_PAGE_BITS, 1, 2, 3, 4]),
    useOf = (key: number) => [1, 6, 1, 9, 8][key]
  const { queue, old } = listEvictions({ pool: [0, 1, 2, 3, 4], keyWords, useOf, now: 9, cap: 8 })
  assert.deepEqual(queue, [2, 0, 1])
  // Ages 8, 8 and 3: the two of age 8 are older than any page the view ahead asks for.
  assert.equal(ageStep(3), OLD_STEP - 1)
  assert.equal(old, 2)
})

test('the readback is the same size whatever the pool holds: one burst per readback', async () => {
  const { gpu, packed, holdAll, cut } = await residentCut(2048)
  const empty = (await cut()).queue
  holdAll()
  assert.deepEqual([empty.length, (await cut()).queue.length], [0, L.EVICTION_BURST])
  // The copy is the readback's whole size, fixed at creation: two lists and one burst.
  const bytes = L.residentReadbackBytes(L.selectionListCap(packed.pageCount))
  for (const b of gpu.buffers) if (b.usage & GPUBufferUsage.MAP_READ) assert.equal(b.size, bytes)
})

test('generated frames: the raised groups say what the cut rule holds, frame after frame', () => {
  const scene = groupedScene(3, 64),
    { packed } = scene,
    keys = pageKeys(packed),
    pages = packed.pageCount
  const lastUse = new Uint32Array(packed.groupCount),
    /** The reference: each key's last frame in a closure, the camera's at the frame, the view
     *  ahead's `AHEAD_AGE` before. */
    held = new Uint32Array(packed.keyCount)
  const pool = Array.from({ length: packed.keyCount }, (_, k) => k)
  const next = random(0x5eed)
  for (let frame = START; frame < START + 80; frame++) {
    const pick = (share: number) =>
      Array.from({ length: pages }, (_, p) => p).filter(() => next() < share)
    const used = pick(0.04),
      ahead = pick(0.02)
    raiseGroups(lastUse, keys.groups, ahead.map(keys.groupOf), aheadClock(frame))
    raiseGroups(lastUse, keys.groups, used.map(keys.groupOf), frame)
    const hold = (ids: readonly number[], at: number) => {
      for (const page of scene.closeOver(ids))
        held[keys.keyOf(page)] = Math.max(held[keys.keyOf(page)], at)
    }
    hold(ahead, aheadClock(frame))
    hold(used, frame)
    for (let page = 0; page < pages; page++)
      assert.equal(lastUse[keys.groupOf(page)], held[keys.keyOf(page)], `${page} at ${frame}`)
    const now = frame + 1
    const { queue, old } = listEvictions({
      pool,
      keyWords: keys.keyWords,
      useOf: (key) => lastUse[keys.groups.keyGroups[key]],
      now,
      cap: L.EVICTION_BURST,
    })
    // What the pages say on their own: every page out of use, older first, finer first.
    const pageOf = (key: number) => canonicalPage(keys.keyWords[key])
    const expected = pool
      .filter((key) => now - held[key] >= 2)
      .map((key) => ({ key, age: now - held[key], level: keys.keyWords[key] >>> KEY_PAGE_BITS }))
      .sort((a, b) => ageStep(b.age) - ageStep(a.age) || a.level - b.level || a.key - b.key)
    assert.deepEqual(
      queue,
      expected.map(({ key }) => pageOf(key)),
      `frame ${frame}`,
    )
    // The old head: older than any page the view ahead asks for, which it may give way to.
    assert.equal(old, expected.filter(({ age }) => age > AHEAD_AGE + 1).length)
  }
})
