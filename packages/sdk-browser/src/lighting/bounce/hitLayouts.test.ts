// The programs of the bounce whose rays are marched through the global distance field and read the surface cache at their hits —
// the screen probes' scene stage, the radiance cache's trace — hold in their layout every binding of
// group 0 their entry reaches, bind the cache's depth and final layers and no other, and fit WebGPU's default limits, the scene
// stage with the reflection group it reads beside.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { reflectionLayout } from '../reflections/reflectionPipelines.ts'
import { reachedBindings } from './reachedBindings.fixture.ts'
import { CACHE_TRACE_PROGRAM } from './cache/cacheTraceWgsl.ts'
import { CACHE_TRACE_HIT, cacheTraceEntries } from './cache/cacheBindings.ts'
import { traceSceneEntries, traceSceneShader, TRACE_SCENE_HIT } from './screen/traceSceneWgsl.ts'

const PROGRAMS = {
  'the screen probes’ scene stage': {
    program: traceSceneShader(8, [4, 4]),
    entry: 'traceScene',
    entries: () => traceSceneEntries(),
    cards: TRACE_SCENE_HIT.cards,
  },
  'the radiance cache’s trace': {
    program: CACHE_TRACE_PROGRAM,
    entry: 'traceTiles',
    entries: () => cacheTraceEntries(),
    cards: CACHE_TRACE_HIT.cards,
  },
} as const

for (const [name, { program, entry, entries, cards }] of Object.entries(PROGRAMS)) {
  test(`${name} holds the bindings its code reaches, the cache’s depth and final layers among them and no other layer`, () => {
    const held = new Set(entries().map(({ binding }) => binding))
    const names = reachedBindings(program, [entry])
    for (const [binding, variable] of names)
      assert.ok(
        held.has(binding),
        `${entry} reaches ${variable} (${binding}), the layout holds none`,
      )
    // The cache's tables, its depth and its final light: offsets 0, 1 and 7 of its layers.
    const layers = [0, 1, 7].map((at) => cards + at)
    const library = [...names.keys()]
      .filter((binding) => binding >= cards && binding < cards + 8)
      .sort((a, b) => a - b)
    assert.deepEqual(library, layers)
    assert.ok(
      layers.every((binding) => held.has(binding)),
      'what a hit reads is bound',
    )
    assert.ok(![2, 3, 4, 5, 6].some((at) => held.has(cards + at)))
  })
}

test('the two programs fit WebGPU’s default limits, the scene stage with the reflection group it reads beside it', () => {
  const { device } = fakeDevice()
  const reflection = reflectionLayout(device)
  for (const [name, { entries }] of Object.entries(PROGRAMS)) {
    const layouts = [
      device.createBindGroupLayout({ entries: entries() as GPUBindGroupLayoutEntry[] }),
    ]
    if (name.includes('scene stage')) layouts.push(reflection)
    const descriptor = { bindGroupLayouts: layouts }
    device.createPipelineLayout(descriptor)
    const counts = stageBindingCounts(descriptor)
    assert.ok(counts.length > 0, name)
    for (const { limit, kind, count } of counts)
      assert.ok(count <= limitOf(limit), `${name}: ${count} ${kind}, past ${limitOf(limit)}`)
  }
})
