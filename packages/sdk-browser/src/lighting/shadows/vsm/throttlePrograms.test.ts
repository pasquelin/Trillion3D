// What the marking, the sampling and the cull run while the compute throttle is on.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { vsmLayout, type VsmLayout } from './layout.ts'
import { vsmPixelPageMarkingWgsl } from './markingWgsl.ts'
import { vsmProjectionSampleWgsl } from './projection/projectionSampleWgsl.ts'
import { vsmRenderCullWgsl } from './render/renderCullWgsl.ts'
import { VSM_RENDER_COUNT_WORDS, vsmFeedbackWords } from './render/renderParamsWgsl.ts'
import { close } from './throttle.fixture.ts'

const PLAIN: VsmLayout = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })

/** The marking's level of a clipmap position as the program computes it; the level of the distance,
 *  the pool's bias and each map's own stand in. */
function markedLevel(throttled: boolean, distanceLevel: number, base: object) {
  const own: Record<number, number> = { 7: 0, 8: 1.5, 9: 3 }
  const run = shaderRun<{ vsmMarkedLevel(...a: unknown[]): number }>(
    vsmPixelPageMarkingWgsl(PLAIN, false, false, throttled),
    ['vsmMarkedLevel'],
    {
      vsm: { pressureBias: 0.5 },
      vsmMarking: { originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
      vsmLevelOfDistanceSq: () => distanceLevel,
      vsmDistanceSqToOrigin: () => 0,
      vsmProjectionData: Object.fromEntries(
        Object.entries(own).map(([id, levelBias]) => [id, { levelBias }]),
      ),
    },
  )
  return run.vsmMarkedLevel(base, [0, 0, 0], 0)
}

const CLIPMAP = { mapLevel: 10, levelsLeft: 4, levelBias: 0.25, handle: { id: 7 } }

test('throttled, the marking adds the bias of the clipmap map the level falls in; else the first map’s', () => {
  // The level 11.2 and the pool's 0.5 fall in the second map (index 1, id 8): 11.7 + 1.5.
  assert.equal(markedLevel(true, 11.2, CLIPMAP), 13)
  assert.equal(markedLevel(false, 11.2, CLIPMAP), 11, 'not throttled: the first map’s 0.25')
  // Past the last level (14.2 + 0.5 is index 4 of 4): the first map's own bias.
  assert.equal(markedLevel(true, 14.2, CLIPMAP), 14)
  // Below the first level the index is 0: the first map's bias, 0.
  assert.equal(markedLevel(true, 8, CLIPMAP), 8)
})

/** The sampled level of a clipmap position, each map's bias standing in. */
function sampledLevel(distanceLevel: number, base: object, biases: Record<number, number>) {
  const run = shaderRun<{ vsmSampledLevel(...a: unknown[]): number }>(
    vsmProjectionSampleWgsl(
      wgslFn('vsmPoolLoad', [], 'fn vsmPoolLoad(t:vec2u,slice:u32)->u32{return 0u;}'),
    ),
    ['vsmSampledLevel'],
    {
      vsmLevelOfDistanceSq: () => distanceLevel,
      vsmDofResolutionBias: () => 0,
      vsmProjectionData: Object.fromEntries(
        Object.entries(biases).map(([id, levelBias]) => [id, { levelBias }]),
      ),
    },
  )
  return run.vsmSampledLevel(base, 1, -1)
}

test('the sampling adds the bias of the clipmap map the level falls in, the first map’s past its levels', () => {
  const biases = { 7: 0.25, 8: 1.5, 9: 3, 10: 4 }
  close(sampledLevel(11.2, CLIPMAP, biases), 11.2 + 1.5, 'the second map’s')
  close(sampledLevel(15, CLIPMAP, biases), 15 + 0.25, 'past the four levels')
  // Without the throttle every map of a clipmap carries the one bias: the base level's, as before.
  const same = { 7: 0.25, 8: 0.25, 9: 0.25, 10: 0.25 }
  for (const level of [8, 10.5, 11.2, 12.9, 13.5, 15])
    close(sampledLevel(level, CLIPMAP, same), level + 0.25, `level ${level}`)
})

test('the cull counts a cluster once a map and a mip, in the totals and the map’s entry, by raster', () => {
  const room = 8,
    mapSlots = 8
  /** The cull's emit over fresh counters; the program with or without the throttle's counts. */
  const emitter = (throttled: boolean) => {
    const code = vsmRenderCullWgsl(PLAIN, throttled),
      C = wgslConstants(code)
    const counts = new Array(VSM_RENDER_COUNT_WORDS + vsmFeedbackWords(mapSlots)).fill(0)
    const emit = shaderRun<{ vsmRenderEmit(...a: unknown[]): void }>(code, ['vsmRenderEmit'], {
      ...C,
      counts,
      records: Array.from({ length: room }, () => [-1, -1, -1, -1]),
      params: { recordCapacity: room },
      vsmTableLevelOrigin: () => ({}),
      vsmTableEntryAt: () => ({}),
      vsmPageMarkWord: () => 0xffffffff,
    })
    return { counts, emit: emit.vsmRenderEmit, C }
  }
  const plain = emitter(false)
  plain.emit(9, 0, 0, { id: 3 }, 0, [0, 0, 2, 0], 1, 1)
  assert.equal(
    plain.counts[plain.C.VSM_RENDER_TIER_RECORDS],
    3,
    'the records are drawn all the same',
  )
  const past = plain.counts.slice(VSM_RENDER_COUNT_WORDS)
  assert.deepEqual(past, new Array(vsmFeedbackWords(mapSlots)).fill(0), 'and none is counted')
  const { counts, emit, C } = emitter(true)
  const feedback = (index: number) =>
    counts.slice(VSM_RENDER_COUNT_WORDS + index, VSM_RENDER_COUNT_WORDS + index + 2)
  const entryOf = (id: number) => vsmFeedbackWords(id)
  // Three windows of one page for one caster in map 3's mip: the hardware raster, counted once.
  emit(9, 0, 0, { id: 3 }, 0, [0, 0, 2, 0], 1, 1)
  assert.deepEqual(
    [feedback(0), feedback(entryOf(3)), counts[C.VSM_RENDER_TIER_RECORDS]],
    [[1, 0], [1, 0], 3],
  )
  // The same caster in another map's mip, drawn by the software raster.
  emit(9, 0, C.VSM_RENDER_SOFTWARE_BIN, { id: 5 }, 0, [0, 0, 1, 0], 1, 1)
  assert.deepEqual(
    [feedback(0), feedback(entryOf(5)), feedback(entryOf(3))],
    [
      [1, 1],
      [0, 1],
      [1, 0],
    ],
  )
})
