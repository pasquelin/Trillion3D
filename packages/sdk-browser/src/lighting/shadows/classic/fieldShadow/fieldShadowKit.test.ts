import assert from 'node:assert/strict'
import test from 'node:test'
import { sameRun, type CascadeSun, type PreparedField } from './fieldShadowKit.ts'

const sun = (far = 100): CascadeSun & { block: number } => ({
  block: 0,
  layer: 0,
  cascade: {
    near: 1,
    far,
    fadePlane: 90,
    fadeLength: 10,
    nearFadeLength: 0,
    centre: 50,
    radius: 60,
  },
  tanLight: 0.01,
  toLight: [0, 1, 0],
  traceDistance: 150,
  startOffset: 0.5,
})
const prepared = { stamp: [1, 2, 640, 360, 0], suns: [sun()] } as unknown as PreparedField

test('the lists stand while the stamp and the suns are the same numbers', () => {
  assert.equal(sameRun(prepared, [1, 2, 640, 360, 0], [sun()]), true)
})

test('a stamp, a cascade or a direction that moved makes the lists again', () => {
  assert.equal(sameRun(prepared, [1, 3, 640, 360, 0], [sun()]), false)
  assert.equal(sameRun(prepared, [1, 2, 640, 360, 0], [sun(120)]), false)
  assert.equal(sameRun(prepared, [1, 2, 640, 360, 0], []), false)
  const turned = { ...sun(), toLight: [0, 0, 1] as [number, number, number] }
  assert.equal(sameRun(prepared, [1, 2, 640, 360, 0], [turned]), false)
})
