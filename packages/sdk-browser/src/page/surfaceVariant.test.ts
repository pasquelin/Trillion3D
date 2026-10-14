import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import type { PageSurface } from './surface.ts'
import { surfaceVariant, variantOf } from './surfaceVariant.ts'

const PLAIN = { vertexColors: false, flatShading: false, twoSided: false }

test('a plain variant is the material record itself', () => {
  const plain = G.standardSurface({ roughness: 0.5 })
  assert.equal(surfaceVariant(plain, new Map(), PLAIN), plain)
})

test('a variant is a record of its own, made once: a write on it never reaches the original', () => {
  const plain = G.standardSurface({ roughness: 0.5 }),
    variants = new Map<string, PageSurface>()
  const cloth = surfaceVariant(plain, variants, { ...PLAIN, twoSided: true })
  assert.notEqual(cloth, plain)
  assert.notEqual(cloth.released, plain.released, 'its own release')
  assert.equal(cloth.version, 0)
  assert.deepEqual([cloth.side, plain.side], ['double', 'front'], 'the side field itself')
  assert.equal(cloth.roughness, 0.5)
  assert.equal(surfaceVariant(plain, variants, { ...PLAIN, twoSided: true }), cloth, 'made once')
  const tinted = surfaceVariant(plain, variants, { ...PLAIN, vertexColors: true })
  assert.deepEqual([tinted.vertexColors, plain.vertexColors, tinted.side], [true, false, 'front'])
})

test("the variant is read off the mesh: its geometry's attributes and its cloth association", () => {
  const bare = { attributes: { position: {} } },
    full = { attributes: { position: {}, normal: {}, color: {} } }
  assert.deepEqual(variantOf(bare, true), {
    vertexColors: false,
    flatShading: true,
    twoSided: true,
  })
  assert.deepEqual(variantOf(full, false), {
    vertexColors: true,
    flatShading: false,
    twoSided: false,
  })
})
