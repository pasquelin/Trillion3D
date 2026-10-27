// The compute throttle's two kernels, run on hand-made buffers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { f32Bits, fromF32Bits } from '../../../../../math/src/float/bits.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { VSM_NEXT_ID_VALID } from './constants.ts'
import { close } from './throttle.fixture.ts'
import { VSM_THROTTLE_PROCESS_WGSL, VSM_THROTTLE_UPDATE_WGSL } from './throttleWgsl.ts'

const bits = (x: number) => f32Bits(x)
const PROCESS_NAMES = ['vsmThrottleProcess']

/** The clusters a previous frame's raster counted in each of its maps, as its feedback holds them. */
const feedbackOf = (counts: [number, number][]) => [
  counts.reduce((sum, [hardware]) => sum + hardware, 0),
  counts.reduce((sum, [, software]) => sum + software, 0),
  ...counts.flat(),
]
/** A throttle buffer's header and entries: the totals, the greatest counts, the global intensity; then
 *  each map's two counts and its intensity (f32 bits). */
const throttleOf = (header: number[], entries: [number, number, number][]) => [
  ...header,
  ...entries.flatMap(([hardware, software, intensity]) => [hardware, software, bits(intensity)]),
]

test('the process kernel carries each previous map’s counts and intensity to its new id, skips a map with no next', () => {
  const C = wgslConstants(VSM_THROTTLE_PROCESS_WGSL)
  // The previous frame's three maps: 0 went to id 1, 1 to id 0, 2 has no next id.
  const nextMaps = [
    [VSM_NEXT_ID_VALID, 1, 0, 0],
    [VSM_NEXT_ID_VALID | 1, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  const outThrottle = new Array(5 + 3 * 3).fill(0)
  const run = shaderRun<{ vsmThrottleProcess(id: number[]): void }>(
    VSM_THROTTLE_PROCESS_WGSL,
    PROCESS_NAMES,
    {
      ...C,
      params: { nextCount: 3 },
      nextMaps,
      outThrottle,
      prevFeedback: feedbackOf([
        [10, 5],
        [40, 0],
        [7, 7],
      ]),
      prevThrottle: throttleOf(
        [0, 0, 0, 0, bits(0.5)],
        [
          [0, 0, 0.1],
          [0, 0, 0.2],
          [0, 0, 0.3],
        ],
      ),
    },
  )
  for (let id = 0; id < 3; id++) run.vsmThrottleProcess([id, 0, 0])
  const head = C.VSM_TB_SIZEOF_HEADER,
    entry = C.VSM_TB_SIZEOF_ENTRY
  assert.deepEqual(
    outThrottle.slice(C.VSM_TB_HEADER_TOTAL_HW_CLUSTERS, C.VSM_TB_HEADER_TOTAL_SW_CLUSTERS + 1),
    [57, 12],
    'the totals of the previous frame, all its maps',
  )
  assert.deepEqual(
    outThrottle.slice(C.VSM_TB_HEADER_MAX_HW_CLUSTERS, C.VSM_TB_HEADER_MAX_SW_CLUSTERS + 1),
    [40, 5],
    'the greatest counts of the maps that went on, not the map with no next',
  )
  assert.deepEqual(outThrottle.slice(head, head + 2), [40, 0], 'id 0 is the previous map 1')
  assert.equal(fromF32Bits(outThrottle[head + 2]), Math.fround(0.2))
  assert.deepEqual(outThrottle.slice(head + entry, head + entry + 2), [10, 5], 'id 1 is map 0')
  assert.equal(fromF32Bits(outThrottle[head + entry + 2]), Math.fround(0.1))
  assert.deepEqual(outThrottle.slice(head + 2 * entry), [0, 0, 0], 'no map went to id 2')
})

const UPDATE_NAMES = ['vsmThrottleUpdate']
const KIND_DIRECTIONAL = 2,
  KIND_SPOT = 1
/** The projection words of records of the kinds `kinds`, each at the bias `bias`. */
function projectionWords(kinds: number[], bias: number, C: Record<string, number>) {
  const words = new Array(kinds.length * C.VSM_PROJECTION_RECORD_WORDS).fill(0)
  kinds.forEach((kind, k) => {
    words[k * C.VSM_PROJECTION_RECORD_WORDS + C.VSM_PROJECTION_KIND_WORD] = kind
    words[k * C.VSM_PROJECTION_RECORD_WORDS + C.VSM_PROJECTION_LEVEL_BIAS_WORD] = bits(bias)
  })
  return words
}

/** The update kernel over three maps (a sun's, a spot's, a sun's) whose counts the process kernel left. */
function updated(params: Record<string, number>) {
  const C = wgslConstants(VSM_THROTTLE_UPDATE_WGSL)
  const outThrottle = throttleOf(
    [12500, 0, 10000, 0, 0],
    [
      [10000, 0, 0.5],
      [2500, 0, 0],
      [0, 0, 0],
    ],
  )
  const words = projectionWords([KIND_DIRECTIONAL, KIND_SPOT, KIND_DIRECTIONAL], 0.25, C)
  const run = shaderRun<{ vsmThrottleUpdate(id: number[]): void }>(
    VSM_THROTTLE_UPDATE_WGSL,
    UPDATE_NAMES,
    {
      ...C,
      params: {
        ...{ slotCount: 3, strength: -1, loadBudget: 1, historyWeight: 0.5 },
        ...{ maxBiasDirectional: 2, maxBiasLocal: 1, ...params },
      },
      outThrottle,
      projectionWords: words,
      prevThrottle: throttleOf([0, 0, 0, 0, bits(0.1)], []),
    },
  )
  for (let id = 0; id < 3; id++) run.vsmThrottleUpdate([id, 0, 0])
  const bias = (id: number) =>
    fromF32Bits(words[id * C.VSM_PROJECTION_RECORD_WORDS + C.VSM_PROJECTION_LEVEL_BIAS_WORD])
  const intensity = (id: number) =>
    fromF32Bits(outThrottle[C.VSM_TB_SIZEOF_HEADER + C.VSM_TB_SIZEOF_ENTRY * id + 2])
  return { bias, intensity, global: fromF32Bits(outThrottle[C.VSM_TB_HEADER_TOTAL_THROTTLE]) }
}

test('the update kernel fits the intensities against the load budget and adds them to the maps’ bias', () => {
  // A load of 0.00012176 · 12500 = 1.522 over a budget of 1: the global intensity rises by half of the
  // excess, at most 0.2, from the previous 0.1.
  const u = updated({})
  close(u.global, 0.3, 'the global intensity')
  // The busiest map: its whole share of the global 0.3, eased half with the 0.5 it had.
  close(u.intensity(0), 0.3 * 0.5 + 0.5 * 0.5, 'the busiest map')
  // A quarter of its cost: a quarter of the global, eased with the 0 it had.
  close(u.intensity(1), 0.25 * 0.3 * 0.5, 'a lighter map')
  // A map that drew nothing takes the global intensity, not eased.
  close(u.intensity(2), 0.3, 'a map with no count')
  // The bias each adds is its intensity times the most its kind may take: 2 for a sun, 1 for a spot.
  close(u.bias(0), 0.25 + 0.4 * 2, 'the sun’s bias')
  close(u.bias(1), 0.25 + 0.0375 * 1, 'the spot’s bias')
  close(u.bias(2), 0.25 + 0.3 * 2, 'the second sun’s bias')
})

test('the dynamic resolution’s strength is the global intensity, whatever the load', () => {
  const u = updated({ strength: 0.6, historyWeight: 0 })
  close(u.global, 0.6, 'the strength')
  close(u.intensity(0), 0.6, 'the busiest map: its share of 1')
  close(u.intensity(1), 0.15, 'a quarter of it')
  close(u.intensity(2), 0.6, 'no count: the global one')
})

test('under the budget the global intensity falls by a hundredth, and never under 0', () => {
  const u = updated({ loadBudget: 1e9 })
  close(u.global, 0.09, 'a step of −0.01 from 0.1')
})
