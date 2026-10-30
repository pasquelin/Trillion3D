// The cached bind group: made again only where what it names moved; a depth of two keeps a group for each of two resources that take turns.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCachedGroup, groupFor, type GroupCache } from './cachedGroup.ts'

const fakeDevice = () => {
  let made = 0
  return {
    device: {
      createBindGroup: () => ({ made: ++made }),
    } as unknown as GPUDevice,
    made: () => made,
  }
}
const layout = {} as GPUBindGroupLayout

test('a group is made once while what it names holds', () => {
  const { device, made } = fakeDevice()
  const group = createCachedGroup()
  const a = {}
  const first = group(device, layout, [a], () => [])
  assert.equal(
    group(device, layout, [a], () => []),
    first,
  )
  assert.equal(made(), 1)
})

test('resources that take turns each keep their group at a depth of two, and are made again at a depth of one', () => {
  const a = {}
  const b = {}
  for (const [depth, expected] of [
    [2, 2],
    [1, 5],
  ] as const) {
    const { device, made } = fakeDevice()
    const group = createCachedGroup(depth)
    for (const named of [a, b, a, b, a]) group(device, layout, [named], () => [])
    assert.equal(made(), expected, `depth ${depth}`)
  }
})

test('a named group is kept per name while its resources hold, and made again where one moved', () => {
  const { device, made } = fakeDevice()
  const targets: GroupCache = { groups: new Map() }
  const a = {}
  const b = {}
  const first = groupFor(device, targets, 'one', layout, [a], () => [])
  assert.equal(
    groupFor(device, targets, 'one', layout, [a], () => []),
    first,
  )
  groupFor(device, targets, 'two', layout, [a], () => [])
  assert.equal(made(), 2)
  assert.notEqual(
    groupFor(device, targets, 'one', layout, [b], () => []),
    first,
  )
  assert.equal(made(), 3)
})
