import test from 'node:test'
import assert from 'node:assert/strict'
import { addGpuPasses, directLightTimings, gpuPassStageOf } from './mapping.ts'
import { PASSES, gpuShadowPartOf } from './passTable.ts'
import type { GpuPassTimings } from '../../../sdk-core/src/index.ts'
import { referenceDirectLightTimings } from '../../../../bench/oracles/browser/stage-profile.ts'
import { DEFERRED_LIGHTING_PASS, LIGHT_TILES_PASS, VSM_PASS_PREFIX } from './passLabels.ts'

/** A pass of the virtual shadow maps: timed with the Shadows stage by its prefix alone. */
const VSM_PASS = `${VSM_PASS_PREFIX}pass`

/** The passes of the table the Shadows stage counts, by the stage `gpuPassStageOf` gives them. */
const SHADOW_STAGE_PASSES = Object.keys(PASSES).filter((name) => gpuPassStageOf(name) === 'shadows')

function sample(passes: GpuPassTimings['passes'], truncated = false): GpuPassTimings {
  return { frame: 1, totalMs: null, truncated, passes }
}

function collect(s: GpuPassTimings | null | undefined) {
  const deposits: Array<[string, number]> = []
  addGpuPasses(s, (stage, ms) => deposits.push([stage, ms]))
  return deposits
}

test('two passes of the same stage sum into one deposit', () => {
  const deposits = collect(
    sample([
      { name: 'Trillion3D visibility primary', gpuMs: 1 },
      { name: 'Trillion3D visibility secondary', gpuMs: 2 },
    ]),
  )
  assert.deepEqual(deposits, [['geometry', 3]])
})

test('a pass with an unknown label joins geometry', () => {
  const deposits = collect(sample([{ name: 'never-seen pass', gpuMs: 5 }]))
  assert.deepEqual(deposits, [['geometry', 5]])
})

test('an unmeasured pass invalidates the whole stage, never a partial sum', () => {
  const alreadyValid = collect(
    sample([
      { name: 'Trillion3D visibility primary', gpuMs: 1 },
      { name: 'Trillion3D visibility secondary', gpuMs: null },
    ]),
  )
  assert.deepEqual(alreadyValid, [])

  const alreadyInvalid = collect(
    sample([
      { name: 'Trillion3D visibility secondary', gpuMs: null },
      { name: 'Trillion3D visibility primary', gpuMs: 1 },
    ]),
  )
  assert.deepEqual(alreadyInvalid, [])
})

test('a truncated or missing sample deposits no stage', () => {
  assert.deepEqual(collect(sample([{ name: 'Trillion3D HiZ', gpuMs: 4 }], true)), [])
  assert.deepEqual(collect(null), [])
  assert.deepEqual(collect(undefined), [])
})

test('directLightTimings reads the three durations by label, null if the pass is absent', () => {
  const timings = directLightTimings(
    sample([
      { name: VSM_PASS, gpuMs: 2 },
      { name: LIGHT_TILES_PASS, gpuMs: 3 },
    ]),
  )
  assert.deepEqual(timings, {
    gpuLightListsMs: 3,
    gpuShadowsMs: 2,
    gpuShadowCullMs: null,
    gpuShadowRasterMs: null,
    gpuLightingMs: null,
  })
})

test('direct lighting keeps its values even when another stage is invalidated', () => {
  const timings = directLightTimings(
    sample([
      { name: VSM_PASS, gpuMs: 2 },
      { name: LIGHT_TILES_PASS, gpuMs: 3 },
      { name: DEFERRED_LIGHTING_PASS, gpuMs: 4 },
      { name: 'Trillion3D visibility primary', gpuMs: null },
      { name: 'Trillion3D empty surfaces', gpuMs: 1 },
    ]),
  )
  assert.deepEqual(timings, {
    gpuLightListsMs: 3,
    gpuShadowsMs: 2,
    gpuShadowCullMs: null,
    gpuShadowRasterMs: null,
    gpuLightingMs: 4,
  })
})

test('shadow time splits into choosing the casters and drawing them, from the same sample', () => {
  const timings = directLightTimings(
    sample([
      { name: 'Trillion3D shadow cull', gpuMs: 0.5 },
      { name: 'Trillion3D shadow page pyramids', gpuMs: 0.25 },
      { name: 'Trillion3D shadow occlusion', gpuMs: 0.25 },
      { name: VSM_PASS, gpuMs: 4 },
      { name: DEFERRED_LIGHTING_PASS, gpuMs: 5 },
    ]),
  )
  assert.equal(timings.gpuShadowCullMs, 1)
  assert.equal(timings.gpuShadowRasterMs, null)
  assert.equal(timings.gpuShadowsMs, 5)
  const unmeasured = directLightTimings(
    sample([
      { name: 'Trillion3D shadow cull', gpuMs: null },
      { name: VSM_PASS, gpuMs: 4 },
    ]),
  )
  assert.equal(unmeasured.gpuShadowCullMs, null, 'an unmeasured pass voids its part')
  assert.equal(unmeasured.gpuShadowRasterMs, null)
})

// One table names every pass: a shadow row without its part would drop out of the split silently.
test('every pass of a shadow stage names its shadow part, and no other pass does', () => {
  const parts = {
    'Trillion3D shadow cull': 'cull',
    'Trillion3D shadow page pyramids': 'cull',
    'Trillion3D shadow occlusion': 'cull',
    [LIGHT_TILES_PASS]: 'other',
    [DEFERRED_LIGHTING_PASS]: 'other',
    'Trillion3D DAG selection': 'other',
    'never-seen pass': 'other',
  }
  for (const [label, part] of Object.entries(parts)) {
    assert.equal(gpuShadowPartOf(label), part, label)
    const shadowStage = ['shadows', 'shadowCasters'].includes(gpuPassStageOf(label))
    assert.equal(part !== 'other', shadowStage, label)
  }
})

test('the bench reference reads the same shadow split as the engine', () => {
  const s = sample([
    { name: 'Trillion3D shadow cull', gpuMs: 0.5 },
    { name: 'Trillion3D shadow page pyramids', gpuMs: 0.25 },
    { name: 'Trillion3D shadow occlusion', gpuMs: 0.25 },
    { name: VSM_PASS, gpuMs: 4 },
    { name: LIGHT_TILES_PASS, gpuMs: 2 },
    { name: DEFERRED_LIGHTING_PASS, gpuMs: 5 },
  ])
  assert.deepEqual(referenceDirectLightTimings(s), directLightTimings(s))
})

test('the three transparent passes sum onto their stage, never onto geometry', () => {
  const deposits = collect(
    sample([
      { name: 'Trillion3D transparents', gpuMs: 2 },
      { name: 'Trillion3D transmission', gpuMs: 3 },
      { name: 'Trillion3D transparent compaction', gpuMs: 1 },
    ]),
  )
  assert.deepEqual(deposits, [['transparents', 6]])
})

// The broad Shadows stage spans the shadow passes of `PASSES` and no other pass.
test('the Shadows stage sums only the shadow passes of the pass table', () => {
  assert.ok(SHADOW_STAGE_PASSES.includes('Trillion3D shadow cull'), 'shadow work, named')
  const others = [LIGHT_TILES_PASS, DEFERRED_LIGHTING_PASS, 'Trillion3D visibility primary']
  const s = sample([
    ...SHADOW_STAGE_PASSES.map((name) => ({ name, gpuMs: 1 })),
    ...others.map((name) => ({ name, gpuMs: 100 })),
  ])
  assert.equal(directLightTimings(s).gpuShadowsMs, SHADOW_STAGE_PASSES.length)
  assert.deepEqual(
    referenceDirectLightTimings(s),
    directLightTimings(s),
    'the bench reads the same',
  )
})
