import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { Color } from '../../../sdk-core/src/world/math/color.ts'
import { surfaceFrontOnly, surfaceOf } from './surface.ts'
import { declareSurface, redeclareSurface } from './surfaceRecord.ts'
import { surfaceJournals, surfaceWritten } from './surfaceWrites.ts'
import { visBin } from '../webgpu/pages/prepare/pipelineFor.ts'
import { BIN_BACK, BIN_NONE } from '../gpu/draw/contract.ts'
import type { PageRec } from './selection/types.ts'
import { identityRoots } from './selection/placements.fixture.ts'

test('a mesh wears its surface record itself: every reader holds the one record', () => {
  const material = G.standardSurface({ color: 0x336699, metalness: 0.25 })
  assert.equal(surfaceOf(material), material, 'no second object stands for the material')
  assert.equal(material.metalness, 0.25)
  const blue = new Color(0x336699)
  assert.deepEqual(material.baseColor, [blue.r, blue.g, blue.b])
  assert.notEqual(surfaceOf(G.standardSurface()), material, 'another declaration, another record')
  material.dispose()
})

test('the side answers what the record holds now, with no reread in between', () => {
  // The opaque path — the pipelines, the face bins, the cut's normal cones — asks for the side. A
  // front-only page carries a closed cone: a stale front on an opened surface would reject it.
  const material = G.basicSurface({ side: G.FRONT_SIDE })
  assert.equal(surfaceFrontOnly(material), true)
  G.sided(material, G.DOUBLE_SIDE)
  assert.equal(material.side, 'double')
  assert.equal(surfaceFrontOnly(material), false)
  G.sided(material, G.BACK_SIDE)
  assert.equal(material.side, 'back')
  assert.equal(surfaceFrontOnly(material), false)
})

test('a redeclared record is filled in place, its version moved and its write journaled', () => {
  const material = G.standardSurface({ roughness: 0.9 })
  const journal = surfaceJournals.open()
  redeclareSurface(material, { family: 'standard', roughness: 0.1 })
  assert.equal(material.roughness, 0.1, 'the same object holds the new value')
  assert.equal(material.version, 1)
  assert.deepEqual([...journal], [material], 'the write lands in every open journal')
  journal.clear()
  surfaceJournals.close(journal)
  surfaceWritten(material)
  assert.equal(journal.size, 0, 'a closed journal hears nothing')
  assert.equal(material.version, 2)
})

test('one write among ten thousand surfaces is the one record a journal holds', () => {
  const surfaces = Array.from({ length: 10_000 }, () => declareSurface({ family: 'basic' }))
  const journal = surfaceJournals.open()
  surfaceWritten(surfaces[4321])
  assert.deepEqual([...journal], [surfaces[4321]], 'a consumer visits one record, not 10⁴')
  surfaceJournals.close(journal)
})

test('a list wears its first surface, and an empty one a shared front, opaque record', () => {
  const opaque = G.basicSurface()
  const blended = G.basicSurface({ transparent: true, opacity: 0.4 })
  assert.equal(surfaceOf([opaque, blended]), opaque, 'the first element decides')
  const empty = surfaceOf([])
  assert.equal(empty.transparent, false)
  assert.equal(empty.side, 'front', 'an empty declaration is drawn front only')
  assert.equal(surfaceOf([]), empty, 'one shared record')
})

test('a declared map its model never reads is refused by name', () => {
  const ramp = G.dataTexture()
  assert.throws(() => G.familySurface('toon', { gradientMap: ramp }), /gradientMap/)
  assert.throws(() => G.familySurface('matcap', { map: ramp }), /declares a map/)
  assert.throws(() => G.familySurface('normal', { normalMap: ramp }), /normalMap/)
})

test('the face bin of a draw follows a side switched in place, so no face is culled for nothing', () => {
  const material = G.basicSurface({ side: G.FRONT_SIDE })
  const rec = { material: surfaceOf(material) } as unknown as PageRec,
    roots = identityRoots()
  assert.equal(visBin(rec, 0, roots), BIN_BACK, 'front-only: the back faces are culled')
  G.sided(material, G.DOUBLE_SIDE)
  assert.equal(
    visBin(rec, 0, roots),
    BIN_NONE,
    'double-sided: nothing is culled, both faces reach the image',
  )
  material.dispose()
})
