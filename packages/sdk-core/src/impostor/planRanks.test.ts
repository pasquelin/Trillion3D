// A plan of some ranks — the roots a view may hold — reads those alone; the others keep the
// verdict the last plan that read them left, and draw no card. Every rank given, it is the plan of
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

test('a plan of some ranks reads those alone, the others keep their verdict', () => {
  const plan = planImpostors(roots, section, VIEW, FOCAL)
  const before = [...plan.switched]
  // The view now holds the first three roots alone.
  const some = (visit: (rank: number) => void) => [0, 1, 2].forEach(visit)
  const again = planImpostors(roots, section, VIEW, FOCAL, plan, some)
  assert.deepEqual(again.visited, [0, 1, 2])
  assert.deepEqual([...again.switched].slice(3), before.slice(3), 'the unread keep theirs')
  assert.ok(
    again.cards.every((card) => card.root < 3),
    'cards only of the ranks read',
  )
})
