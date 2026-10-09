import test from 'node:test'
import assert from 'node:assert/strict'
import { addGpuPasses, directLightTimings, gpuPassStageOf } from './mapping.ts'
import { DECLARED_PASSES } from './passTable.ts'
import type { GpuPassTimings } from '../../../sdk-core/src/index.ts'
import { referenceDirectLightTimings } from '../../../../bench/oracles/browser/stage-profile.ts'
import { DEFERRED_LIGHTING_PASS, LIGHT_TILES_PASS, VSM_PASS_PREFIX } from './passLabels.ts'

/** A pass of the virtual shadow maps: timed with the Shadows stage by its family's prefix. */
const VSM_PASS = `${VSM_PASS_PREFIX}pass`

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

test('a pass with an unknown label joins no stage', () => {
  const deposits = collect(
    sample([
      { name: 'never-seen pass', gpuMs: 5 },
      { name: 'Trillion3D visibility primary', gpuMs: 1 },
    ]),
  )
  assert.deepEqual(deposits, [['geometry', 1]])
  assert.equal(gpuPassStageOf('never-seen pass'), undefined)
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
    gpuLightingMs: 4,
  })
})

test('the bench reference reads the same direct-light durations as the engine', () => {
  const s = sample([
    { name: VSM_PASS, gpuMs: 4 },
    { name: `${VSM_PASS_PREFIX}other pass`, gpuMs: 1 },
    { name: LIGHT_TILES_PASS, gpuMs: 2 },
    { name: DEFERRED_LIGHTING_PASS, gpuMs: 5 },
  ])
  assert.deepEqual(referenceDirectLightTimings(s), directLightTimings(s))
  assert.equal(directLightTimings(s).gpuShadowsMs, 5)
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

// The Shadows stage spans the virtual shadow maps' passes, by their prefix, and no other pass.
test('the Shadows stage sums only the virtual shadow map passes', () => {
  assert.deepEqual(
    DECLARED_PASSES.filter(({ stage }) => stage === 'shadows'),
    [],
    'the family is the one rule: no declared pass joins the Shadows stage',
  )
  const shadows = [VSM_PASS, `${VSM_PASS_PREFIX}other pass`]
  const others = [LIGHT_TILES_PASS, DEFERRED_LIGHTING_PASS, 'Trillion3D visibility primary']
  const s = sample([
    ...shadows.map((name) => ({ name, gpuMs: 1 })),
    ...others.map((name) => ({ name, gpuMs: 100 })),
  ])
  assert.equal(directLightTimings(s).gpuShadowsMs, shadows.length)
  assert.deepEqual(
    referenceDirectLightTimings(s),
    directLightTimings(s),
    'the bench reads the same',
  )
})
