// The whole read over a slice laid out as the resolve writes it (`transmissionRead.fixture.ts`):
// equal to a brute-force cast in 8 bits for one layer, only the layers above the receiver counted
// whatever the list order, a translucent receiver never shadowed by its own triangle.
import test from 'node:test'
import assert from 'node:assert/strict'
import { type Caster, memoryOf, pack, readAt, reader } from './transmissionRead.fixture.ts'
import { byte, oracle, scene } from './transmissionScenes.fixture.ts'
import { type Tri, f32, random } from './transmissionSheets.fixture.ts'

test('one layer: the read equals a brute-force cast in 8 bits, and the interior the texel store’s exactly', () => {
  for (const seed of [1, 2, 3]) {
    const casters = scene(seed)
    const read = reader(memoryOf(casters))
    const rnd = random(100 + seed)
    for (let k = 0; k < 400; k++) {
      const p = [128 * rnd(), 128 * rnd()].map(f32)
      const got = readAt(read, p, 0.001)
      assert.deepEqual(byte(got), byte(oracle(casters, p, 0.001)), `seed ${seed} at ${p}`)
    }
  }
})

test('several layers: only those above the receiver count, three or more in a fixed order', () => {
  const tri: Tri = [
    [10, 10],
    [100, 12],
    [20, 110],
  ]
  const colours = [
    pack([0.3, 0.5, 0.7]),
    pack([0.6, 0.2, 0.4]),
    pack([0.1, 0.9, 0.5]),
    pack([0.5, 0.5, 0.5]),
  ]
  const layers = colours.map((q, k) => ({ tri, d: [1 + k, 1 + k, 1 + k], q }))
  const p = [30.25, 40.75]
  for (const order of [
    [0, 1, 2, 3],
    [3, 1, 0, 2],
  ]) {
    const casters = order.map((k) => layers[k])
    const read = reader(memoryOf(casters))
    for (const z of [0.5, 1.5, 2.5, 3.5, 4.5]) {
      const got = readAt(read, p, z)
      const want = oracle(casters, p, z)
      got.forEach((c, i) => assert.ok(Math.abs(c - want[i]) < 1e-12, `z ${z}: ${got} ${want}`))
    }
    // The same bits whatever order the lists hold.
    if (order[0] === 3) {
      const first = reader(memoryOf(layers))
      assert.deepEqual(readAt(read, p, 0.5), readAt(first, p, 0.5))
    }
  }
})

test('a translucent receiver is never shadowed by its own triangle; a crest between it and the light is', () => {
  const surface: Caster = {
    tri: [
      [0, 0],
      [128, 0],
      [0, 128],
    ],
    d: [1, 1.5, 2],
    q: pack([0.5, 0.5, 0.5]),
  }
  const crest: Caster = {
    tri: [
      [40, 30],
      [70, 30],
      [40, 60],
    ],
    d: [3, 3, 3],
    q: pack([0.25, 0.25, 0.25]),
  }
  const read = reader(memoryOf([surface, crest]))
  const p = [20.5, 20.5]
  // On the surface (height 1 + 0.5·x/128 + y/128), moved off it by the normal bias toward the light.
  const z = 1 + (0.5 * p[0]) / 128 + p[1] / 128 + 1e-4
  assert.deepEqual(readAt(read, p, z), [1, 1, 1])
  const q = [45.5, 35.5]
  const under = readAt(read, q, 1 + (0.5 * q[0]) / 128 + q[1] / 128 + 1e-4)
  assert.deepEqual(byte(under), byte([0.75, 0.75, 0.75]))
})
