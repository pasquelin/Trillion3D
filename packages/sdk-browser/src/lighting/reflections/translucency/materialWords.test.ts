// The material words a placement has in the scene trace's table (`materialWords.ts`): what a surface makes of them, and the text that reads them.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TRACED_MATERIAL_AT as A,
  TRACED_MATERIAL_FLAGS,
  TRACED_MATERIAL_WORDS,
  TRACED_MATERIAL_WGSL,
  tracedMaterialsOf,
} from './materialWords.ts'

const flagsOf = (words: Float32Array, at: number) => new Uint32Array(words.buffer)[at + A.flags]

test('a placement that wears no surface is opaque grey', () => {
  const words = tracedMaterialsOf([{}])
  assert.equal(words.length, TRACED_MATERIAL_WORDS)
  assert.deepEqual([...words.subarray(A.diffuse, A.diffuse + 3)], [0.5, 0.5, 0.5])
  assert.equal(words[A.opacity], 1)
  assert.equal(flagsOf(words, 0), 0)
})

test('a metal has no diffuse colour and the base colour for its specular', () => {
  const words = tracedMaterialsOf([
    {
      worn: {
        surface: {
          baseColor: [1, 0.5, 0.25],
          metalness: 1,
          roughness: 0.3,
          emissive: [0, 0, 0],
          opacity: 1,
        },
      },
    },
  ])
  assert.deepEqual([...words.subarray(A.diffuse, A.diffuse + 3)], [0, 0, 0])
  assert.deepEqual([...words.subarray(A.specular, A.specular + 3)], [1, 0.5, 0.25])
  assert.ok(Math.abs(words[A.roughness]! - 0.3) < 1e-6)
})

test('a transmissive surface is translucent, bends its rays and lets its attenuation colour through', () => {
  const words = tracedMaterialsOf([
    {
      worn: {
        surface: {
          baseColor: [1, 1, 1],
          metalness: 0,
          roughness: 0,
          emissive: [0, 0, 0],
          opacity: 1,
          transmission: 1,
          ior: 1.5,
          attenuationColor: [0.5, 1, 1],
        },
      },
    },
  ])
  assert.equal(words[A.ior], 1.5)
  assert.deepEqual([...words.subarray(A.through, A.through + 3)], [0.5, 1, 1])
  assert.equal(flagsOf(words, 0), TRACED_MATERIAL_FLAGS.worn | TRACED_MATERIAL_FLAGS.translucent)
})

test('a blended surface is translucent with its opacity as coverage and lets nothing through its coverage', () => {
  const words = tracedMaterialsOf([
    {
      worn: {
        surface: {
          baseColor: [1, 0, 0],
          metalness: 0,
          roughness: 1,
          emissive: [0, 0, 0],
          opacity: 0.25,
          transparent: true,
        },
      },
    },
  ])
  assert.equal(words[A.opacity], 0.25)
  assert.deepEqual([...words.subarray(A.through, A.through + 3)], [0, 0, 0])
  assert.equal(words[A.ior], 1)
  assert.ok((flagsOf(words, 0)! & TRACED_MATERIAL_FLAGS.translucent) !== 0)
})

test('the reader assembles with the path and holds no backtick', () => {
  assert.ok(!TRACED_MATERIAL_WGSL.text.includes('`'))
})
