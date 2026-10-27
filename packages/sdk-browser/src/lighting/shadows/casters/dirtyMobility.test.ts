// The placements' words follow the placements touched, not the span between them: two models moving
// at both ends of the roots write their own words, and the GPU holds, word for word, what a whole
// write holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MOBILITY_MOVING, MOBILITY_SHADOWLESS } from '../mobilityBits.ts'
import { rootWordsTwin } from './rootWords.fixture.ts'

const ROOTS = 1000,
  /** Pages each placement holds. */
  PAGES = 3

const twin = () => rootWordsTwin(ROOTS, PAGES)

test('the words of a new set of roots are written once, a change writes the placements’ own', () => {
  const { rt, roots, held, sent, upload } = twin(),
    { mobility } = rt.lights
  // The pages the words name are no longer counted: they sized the raster's chunks, gone.
  assert.equal(upload(), true)
  assert.equal(sent(), ROOTS, 'every word once')
  // One placement turned moving at one end, one parked at the other: what an image of the scene
  // changes.
  mobility.move(3, roots[3].world.elements, true)
  ;(roots[ROOTS - 2] as { parked?: boolean }).parked = true
  mobility.touch(ROOTS - 2)
  assert.equal(upload(), true)
  assert.equal(sent(), 2, 'their two words, apart')
  const words = held()
  assert.equal(words[3], MOBILITY_MOVING)
  assert.equal(words[ROOTS - 2], MOBILITY_SHADOWLESS)
  assert.equal(words.filter((word) => word !== 0).length, 2, 'and the change reached nothing else')
  // A still image writes nothing.
  assert.deepEqual([upload(), sent()], [false, 0])
})

test('placements next to each other are written in one run, with the same words', () => {
  const { rt, roots, held, sent, upload, writes, inWords } = twin(),
    { mobility } = rt.lights
  upload()
  sent()
  for (const rank of [10, 11, 12, 500]) mobility.move(rank, roots[rank].world.elements, true)
  upload()
  assert.equal(writes.filter(inWords).length, 2, 'three neighbours in one write, one apart')
  assert.equal(sent(), 4, 'four words')
  const words = held()
  for (const rank of [10, 11, 12, 500]) assert.equal(words[rank], MOBILITY_MOVING, `${rank}`)
  assert.equal(words.filter((word) => word !== 0).length, 4)
})

test('a set of roots grown writes every word again, and keeps the state', () => {
  const { rt, roots, held, sent, upload } = twin(),
    { mobility } = rt.lights
  upload()
  mobility.move(7, roots[7].world.elements, true)
  upload()
  sent()
  roots.push({ world: { elements: new Float64Array(16) }, pages: new Array(PAGES).fill({}) })
  assert.ok(upload())
  assert.equal(mobility.moves(7), true, 'a moving placement stays moving')
  assert.equal(sent(), ROOTS + 1, 'the set is written whole')
  assert.equal(held()[7], MOBILITY_MOVING)
})

test('turning shadowCacheDeformableMeshesInvalidate puts the deformers through a forced move, the others stay', () => {
  const { rt, roots, context, upload } = twin(),
    { mobility } = rt.lights
  ;(roots[7] as { deformation?: object }).deformation = {}
  upload()
  for (let frame = 0; frame < 101; frame++) mobility.settle(100)
  upload()
  assert.deepEqual([mobility.moves(7), mobility.moves(8)], [false, false], 'settled')
  context.shadowCacheDeformableMeshesInvalidate = false
  upload()
  assert.deepEqual([mobility.moves(7), mobility.moves(8)], [true, false], 'off: the deformer moves')
  for (let frame = 0; frame < 101; frame++) mobility.settle(100)
  context.shadowCacheDeformableMeshesInvalidate = true
  upload()
  assert.deepEqual([mobility.moves(7), mobility.moves(8)], [true, false], 'on: it moves again')
})
