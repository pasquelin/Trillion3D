import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import { surfaceOf } from './surface.ts'
import { declareSurface, redeclareSurface } from './surfaceRecord.ts'
import { surfaceJournals, surfaceWritten } from './surfaceWrites.ts'
import { surfaceRow } from '../rows/surfaceRow.ts'
import { FLAG_BACK, FLAG_DOUBLE } from '../../visibility/types.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'

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
  // The opaque path — the pipelines, the face bins — asks for the side: a stale side on a surface
  // sided again would draw the faces it no longer shows.
  const material = G.basicSurface({ side: G.FRONT_SIDE })
  assert.equal(material.side, 'front')
  G.sided(material, G.DOUBLE_SIDE)
  assert.equal(material.side, 'double')
  G.sided(material, G.BACK_SIDE)
  assert.equal(material.side, 'back')
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

test('the face flags of a draw follow a side switched in place, so no face is culled for nothing', () => {
  // The bins pick a face mode from these two bits of the surface's row (`binsWgsl.ts`).
  const material = G.basicSurface({ side: G.FRONT_SIDE })
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const faces = () => surfaceRow(surfaceOf(material), layers).bits & (FLAG_DOUBLE | FLAG_BACK)
  assert.equal(faces(), 0, 'front-only: the back faces are culled')
  G.sided(material, G.DOUBLE_SIDE)
  assert.equal(faces(), FLAG_DOUBLE, 'double-sided: nothing is culled, both faces reach the image')
  G.sided(material, G.BACK_SIDE)
  assert.equal(faces(), FLAG_BACK, 'back-only: the front faces are culled')
  material.dispose()
})

test('a physical surface refracts where it declares its ior, or where its graph wires a refraction', () => {
  const graph = material.graph('surface')
  graph.output('refraction', graph.constant(1.33))
  const refracts = (d: Parameters<typeof declareSurface>[0]) => declareSurface(d).refracts
  assert.equal(refracts({ family: 'physical' }), false, 'the default ior is for Fresnel alone')
  assert.equal(refracts({ family: 'physical', ior: 1.5 }), true)
  assert.equal(refracts({ family: 'physical', graph }), true)
  assert.equal(
    refracts({ family: 'standard', graph }),
    false,
    'a surface that does not transmit bends nothing',
  )
})

test('a lit surface whose graph wires a thin translucent output transmits, whatever its transmission', () => {
  const thin = material.graph('surface')
  thin.output('transmittanceColor', thin.constant(0.2, 0.5, 0.9))
  const transmission = (d: Parameters<typeof declareSurface>[0]) => declareSurface(d).transmission
  assert.equal(transmission({ family: 'standard', graph: thin }), 1)
  assert.equal(transmission({ family: 'physical', transmission: 0.3, graph: thin }), 1)
  assert.equal(
    transmission({ family: 'basic', graph: thin }),
    0,
    'an unlit surface is not thin translucent',
  )
  assert.equal(transmission({ family: 'physical', transmission: 0.3 }), 0.3)
})

test('a sky surface is a blended layer that replaces what is behind it, tested against the depth and writing none', () => {
  const sky = declareSurface({
    family: 'standard',
    sky: true,
    opacity: 0.4,
    blending: 'additive',
    depthTest: false,
    depthWrite: true,
  })
  assert.equal(sky.transparent, true, 'the opaque passes draw nothing of it')
  assert.equal(sky.opacity, 1)
  assert.equal(sky.blending, 'normal')
  assert.equal(sky.depthTest, true)
  assert.equal(sky.depthWrite, false)
  const plain = declareSurface({ family: 'standard', opacity: 0.4 })
  assert.equal(plain.transparent, false)
  assert.equal(plain.opacity, 0.4)
})
