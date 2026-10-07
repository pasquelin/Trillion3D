// A plan of some ranks — the roots a view may hold — reads those alone; the others keep the
// verdict the last plan that read them left, and draw no card: a camera turning hands the GPU cut
// no card bit, as the plan of every root does. Every rank given, it is the plan of
// every root, card for card.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planImpostors, type ImpostorRoot } from './plan.ts'
import { bakedMesh } from './bakedMesh.fixture.ts'
import type { ImpostorSection } from '../contracts/impostor.ts'

const FOCAL = 1117
const TREE = { objectRadius: 4.2, rootTriangles: 2100, coverage: 0.43, frameSide: 128 }
const section: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: FOCAL,
  textureLimit: 8192,
  baked: 1,
  refused: 0,
  meshes: [bakedMesh(1, 'tree', TREE)],
}
const VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Trees down -z, every 50 m: the first near enough to keep its geometry, the far ones switched. */
const roots: ImpostorRoot[] = Array.from({ length: 12 }, (_, k) => ({
  mesh: 1,
  world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10 - 50 * k, 1] },
}))
const every = (visit: (rank: number) => void) => roots.forEach((_, rank) => visit(rank))

test('every rank given, the plan is the plan of every root', () => {
  const all = planImpostors(roots, section, VIEW, FOCAL),
    switched = [...all.switched],
    cards = all.cards.map((card) => card.root)
  const given = planImpostors(roots, section, VIEW, FOCAL, undefined, every)
  assert.deepEqual([...given.switched], switched)
  assert.deepEqual(
    given.cards.map((card) => card.root),
    cards,
  )
  assert.ok(switched.includes(1) && switched.includes(0), 'near trees whole, far ones switched')
})

test('a plan of some ranks reads those alone; a rank it left keeps its verdict', () => {
  const plan = planImpostors(roots, section, VIEW, FOCAL)
  const before = [...plan.switched]
  assert.ok(before.slice(3).includes(1), 'far trees switched')
  // The view now holds the first three roots alone: the far trees keep the bit the last read left.
  const some = (visit: (rank: number) => void) => [0, 1, 2].forEach(visit)
  const again = planImpostors(roots, section, VIEW, FOCAL, plan, some)
  assert.deepEqual(again.visited, [0, 1, 2], 'the ranks read, and no other handed over')
  assert.deepEqual([...again.switched], before, 'no card bit moves by leaving the view')
  assert.ok(
    again.cards.every((card) => card.root < 3),
    'cards only of the ranks read',
  )
})

/** `count` trees on a ring of radius 300 m about the eye, every one far enough to switch. */
const ring = (count: number): ImpostorRoot[] =>
  Array.from({ length: count }, (_, k) => {
    const a = (2 * Math.PI * k) / count
    return {
      mesh: 1,
      world: {
        elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 300 * Math.sin(a), 0, -300 * Math.cos(a), 1],
      },
    }
  })

test('a camera turning in place hands the cut the card bits the plan of every root does', () => {
  // A still eye turning: no tree comes nearer or goes farther, so no verdict moves. The ranks read
  // are those of a quarter turn about the heading (what a placement tree keeps); each image counts
  // the card bits it hands the GPU cut — each one voids the cut in hand, which then publishes in
  // full. A fresh plan reads every root first, as the plan of every root does: each tree takes its
  // card at the first image, never one by one as the view first reaches it.
  const trees = ring(200)
  const handedBy = (some: boolean) => {
    const bits = new Uint8Array(trees.length)
    let plan: ReturnType<typeof planImpostors> | undefined,
      handed = 0,
      voiding = 0
    for (let frame = 0; frame < 40; frame++) {
      const heading = (frame * 2 * Math.PI) / 40
      const inView = (visit: (rank: number) => void) =>
        trees.forEach((_, k) => {
          const off = Math.abs(
            (((2 * Math.PI * k) / 200 - heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
          )
          if (off < Math.PI / 4) visit(k)
        })
      plan = planImpostors(trees, section, VIEW, FOCAL, plan, some ? inView : undefined)
      const read = plan.visited ?? trees.map((_, rank) => rank)
      const before = handed
      for (const rank of read) if (plan.switched[rank] !== bits[rank]) handed++
      for (const rank of read) bits[rank] = plan.switched[rank]
      if (handed > before) voiding++
    }
    return { handed, voiding }
  }
  const every = handedBy(false)
  assert.ok(every.handed > 0, 'the trees in front carded at the first image')
  assert.deepEqual(handedBy(true), every, 'the same bits, at the same image: one cut voided')
  assert.equal(every.voiding, 1)
})

test('a new focal length retakes the depths of the ranks read, as the plan of every root does', () => {
  const some = (visit: (rank: number) => void) => [4, 7].forEach(visit)
  const plan = planImpostors(roots, section, VIEW, FOCAL, undefined, every)
  planImpostors(roots, section, VIEW, FOCAL / 8, plan, some)
  const fresh = planImpostors(roots, section, VIEW, FOCAL / 8)
  for (const rank of [4, 7]) assert.equal(plan.switched[rank], fresh.switched[rank], `rank ${rank}`)
})
