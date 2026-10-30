import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIGHT_KIND,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  LIGHT_UNDRAWN_SHIFT,
} from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { LIGHT_FIELD, baseOf } from '../../../../../sdk-core/src/scene/light/fields.ts'
import {
  LIGHT_GRID_KIND_SHIFT,
  LIGHT_GRID_RECORD_WORDS,
  createLightGridLights,
  gatherLightGridLights,
  pointLightBounds,
  rectLightBounds,
  spotLightBounds,
} from './lightGridLights.ts'

interface Spec {
  kind: number
  at?: number[]
  range?: number
  direction?: number[]
  cos?: number
}

function table(specs: Spec[]) {
  const packed = new Float32Array(SCENE_LIGHT_HEADER_FLOATS + specs.length * SCENE_LIGHT_FLOATS)
  const words = new Uint32Array(packed.buffer)
  specs.forEach((s, slot) => {
    const base = baseOf(slot)
    words[base + LIGHT_FIELD.kind] = s.kind
    packed.set(s.at ?? [0, 0, 0], base + LIGHT_FIELD.position)
    packed[base + LIGHT_FIELD.range] = s.range ?? 0
    packed.set(s.direction ?? [0, 0, -1], base + LIGHT_FIELD.direction)
    packed[base + LIGHT_FIELD.cosCone] = s.cos ?? 0
  })
  return { packed, count: specs.length }
}

test('the box of a point light is its sphere', () => {
  const lo = [0, 0, 0]
  const hi = [0, 0, 0]
  pointLightBounds([1, 2, 3], 2, lo, hi)
  assert.deepEqual(
    [lo, hi],
    [
      [-1, 0, 1],
      [3, 4, 5],
    ],
  )
})

test('the box of a spot is the ray to its tip, the disc of its end and the axes inside the cone', () => {
  const lo = [0, 0, 0]
  const hi = [0, 0, 0]
  // A narrow cone down +x: the tip is on the x axis, the axis point lies inside the cone.
  spotLightBounds([0, 0, 0], [1, 0, 0], 10, Math.cos(0.1), lo, hi)
  assert.equal(hi[0], 10)
  assert.equal(lo[0], 0)
  assert.ok(Math.abs(hi[1]! - 10 * Math.sin(0.1)) < 1e-5)
  assert.ok(Math.abs(lo[1]! + 10 * Math.sin(0.1)) < 1e-5)
})

test('the box of a rectangle is the disc of its reach and the far corner in the direction of its normal', () => {
  const lo = [0, 0, 0]
  const hi = [0, 0, 0]
  rectLightBounds([0, 0, 0], [0, 0, 1], 4, lo, hi)
  assert.deepEqual(
    [lo, hi],
    [
      [-4, -4, 0],
      [4, 4, 4],
    ],
  )
})

test('the suns are kept by rank, the local lights by record, a light with no reach is left out', () => {
  const into = createLightGridLights()
  gatherLightGridLights(
    table([
      { kind: LIGHT_KIND.directional },
      { kind: LIGHT_KIND.point, at: [10, 0, 0], range: 5 },
      { kind: LIGHT_KIND.point, at: [0, 0, 0], range: 0 },
      { kind: LIGHT_KIND.spot, at: [0, 20, 0], range: 4, direction: [0, 1, 0], cos: 0.5 },
    ]),
    into,
  )
  assert.equal(into.suns, 1)
  assert.equal(into.sunRanks[0], 0)
  assert.equal(into.finite, 2)
  assert.equal(into.lights, 4)
  assert.equal(into.words[8]! & 0x3fffffff, 1)
  assert.equal(into.words[8]! >>> LIGHT_GRID_KIND_SHIFT, LIGHT_KIND.point)
  assert.equal(into.words[LIGHT_GRID_RECORD_WORDS + 8]! & 0x3fffffff, 3)
  assert.equal(into.boundMax[0], 15)
  assert.equal(into.boundMin[1], -5)
  assert.equal(into.boundMax[1], 24)
})

test('the local records are sorted by type, then by slot, and a light the view leaves out is kept', () => {
  const into = createLightGridLights()
  const data = table([
    { kind: LIGHT_KIND.rect, at: [0, 0, 0], range: 3 },
    { kind: LIGHT_KIND.spot, at: [1, 0, 0], range: 3, cos: 0.5 },
    { kind: LIGHT_KIND.point, at: [2, 0, 0], range: 3 },
    { kind: LIGHT_KIND.point, at: [3, 0, 0], range: 3 },
  ])
  // The point at slot 2 is out of the view's draw range: the reference grid keeps it all the same.
  new Uint32Array(data.packed.buffer)[baseOf(2) + LIGHT_FIELD.kind]! |= 2 ** LIGHT_UNDRAWN_SHIFT
  gatherLightGridLights(data, into)
  const slots = [0, 1, 2, 3].map((i) => into.words[i * LIGHT_GRID_RECORD_WORDS + 8]! & 0x3fffffff)
  assert.deepEqual(slots, [2, 3, 1, 0])
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => into.words[i * LIGHT_GRID_RECORD_WORDS + 8]! >>> LIGHT_GRID_KIND_SHIFT),
    [LIGHT_KIND.point, LIGHT_KIND.point, LIGHT_KIND.spot, LIGHT_KIND.rect],
  )
})
