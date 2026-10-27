// The view passes (`renderViewPasses.ts`) group the frame's lights by the ids of their maps, whatever the
// order the lights come in: the ids lie by range (`mapIds.ts`), the plan's records keep the lights' order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmViewPasses } from './renderViewPasses.ts'
import type { VsmViewLight } from '../mapViews.ts'

// A sun of five levels, a full cube-mapped local light, then a distant one: the distant light's single
// page lies first, then the sun, then the local light.
const sun: VsmViewLight = { kind: 'directional', count: 5, firstId: 1 }
const full: VsmViewLight = { kind: 'point', count: 6, firstId: 6 }
const distant: VsmViewLight = { kind: 'point', count: 1, firstId: 0 }

test('a pass spans the ids of its lights, whatever the order the lights are in', () => {
  const { list, maps, mostMaps } = vsmViewPasses([sun, full, distant], Infinity)
  assert.deepEqual(
    list.map(({ first, maps }) => [first, maps]),
    [[0, 12]],
  )
  assert.deepEqual([maps, mostMaps], [12, 12])
  // The same lights in the order of their ids give the same passes.
  const same = vsmViewPasses([distant, sun, full], Infinity)
  assert.deepEqual(
    same.list.map(({ first, maps }) => [first, maps]),
    [[0, 12]],
  )
})

test('a pass is closed before the light that would take its ids past the limit, in the order of the ids', () => {
  const { list } = vsmViewPasses([sun, full, distant], 7)
  // The distant light and the sun fill the first pass's six; the local light's six ids open the next.
  assert.deepEqual(
    list.map(({ first, maps }) => [first, maps]),
    [
      [0, 6],
      [6, 6],
    ],
  )
})

test('lights with no ids yet (the bound before the maps are set up) follow one another', () => {
  const { list } = vsmViewPasses(
    [
      { kind: 'directional', count: 5 },
      { kind: 'point', count: 6 },
    ],
    Infinity,
  )
  assert.deepEqual(
    list.map(({ first, maps }) => [first, maps]),
    [[0, 11]],
  )
})
