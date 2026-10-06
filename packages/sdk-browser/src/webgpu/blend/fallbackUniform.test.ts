import test from 'node:test'
import assert from 'node:assert/strict'
import { FALLBACK_UNIFORM, writeFallbackUniform } from './uniforms.ts'
import { SHADER } from '../pages/prepare/shaders.ts'

const WGSL_WORDS: Record<string, number> = { mat4x4f: 16, vec4f: 4, vec2f: 2, u32: 1, f32: 1 }

test('the fallback offsets follow the shader struct they fill', () => {
  const fields = /struct Uniforms\{([^}]*)\}/.exec(SHADER)![1].split(',').filter(Boolean)
  const at: Record<string, number> = {}
  let word = 0
  for (const field of fields) {
    const [name, type] = field.split(':')
    at[name] = word
    word += WGSL_WORDS[type]
  }
  const { projection, world, color, pageOffset, indexCount, mode, identity } = FALLBACK_UNIFORM
  const { lineWidth, pixelRatio, width, dash, sprite } = FALLBACK_UNIFORM
  assert.deepEqual(at, {
    viewProj: projection,
    world,
    color,
    pageOffset,
    indexCount,
    mode,
    identity,
    lineWidth,
    pixelRatio,
    viewport: width,
    dash,
    sprite,
  })
  assert.equal(word, FALLBACK_UNIFORM.spriteMode + 1)
})

test('fallback packing writes every shader word at its offset and preserves integer bits', () => {
  const packed = new Float32Array(128).fill(7),
    ints = new Uint32Array(packed.buffer)
  const projection = Array.from({ length: 16 }, (_, i) => i + 1)
  const world = projection.map((n) => -n)
  writeFallbackUniform(packed, ints, 64, {
    projection,
    world,
    color: [0.25, 0.5, 0.75],
    opacity: 1,
    pageOffset: 0x80000001,
    indexCount: 0x80000002,
    mode: 3,
    identity: 0xfedcba98,
    lineWidth: 2,
    pixelRatio: 1.5,
    width: 1280,
    height: 720,
    dash: 4,
    gap: 5,
    spriteRotation: 0.5,
    spriteMode: -1,
  })
  assert.deepEqual(Array.from(packed.subarray(64, 100)), [
    ...projection,
    ...world,
    0.25,
    0.5,
    0.75,
    1,
  ])
  assert.deepEqual(Array.from(ints.subarray(100, 104)), [0x80000001, 0x80000002, 3, 0xfedcba98])
  assert.deepEqual(Array.from(packed.subarray(104, 112)), [2, 1.5, 1280, 720, 4, 5, 0.5, -1])
  assert.ok(packed.subarray(0, 64).every((word) => word === 7))
  assert.ok(packed.subarray(112).every((word) => word === 7))
})
