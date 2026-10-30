// The programs of the bounce whose rays are marched through the global distance field (or cast through the scene's triangles) and read the surface cache at their hits —
// the screen probes' scene stage, marched or traced, and the radiance cache's trace — hold in their layout every binding of
// group 0 their entry reaches, bind the cache's depth and final layers and no other, and fit WebGPU's default limits, the scene
// stage with the reflection group it reads beside.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { reflectionSceneLayout } from '../reflections/reflectionPipelines.ts'
import { REFLECTION_GROUP } from '../reflections/viewLayout.ts'
import { reachedBindings } from './reachedBindings.fixture.ts'
import { cacheTracedProgramOf, cacheTraceProgramOf } from './cache/cacheTraceWgsl.ts'
import {
  CACHE_TRACED_HIT,
  CACHE_TRACE_HIT,
  cacheTraceEntries,
  cacheTracedLayouts,
} from './cache/cacheBindings.ts'
import { traceSceneEntries, traceSceneShader, TRACE_SCENE_HIT } from './screen/traceSceneWgsl.ts'
import {
  traceTracedEntries,
  traceTracedShader,
  TRACE_TRACED_HIT,
} from './screen/traceTracedWgsl.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

const CACHE_TRACE_PROGRAM = cacheTraceProgramOf(WORD_LIGHT_FORMAT, false)
const CACHE_TRACED_PROGRAM = cacheTracedProgramOf(WORD_LIGHT_FORMAT)

const PROGRAMS = {
  'the screen probes’ scene stage': {
    program: traceSceneShader(8, [4, 4], false, [], undefined, false),
    entry: 'traceScene',
    entries: () => traceSceneEntries(false, undefined, false),
    cards: TRACE_SCENE_HIT.cards,
  },
  'the screen probes’ scene stage, the fog on its rays': {
    program: traceSceneShader(8, [4, 4], true, [], undefined, false),
    entry: 'traceScene',
    entries: () => traceSceneEntries(true, undefined, false),
    cards: TRACE_SCENE_HIT.cards,
  },
  'the screen probes’ scene stage through the scene’s triangles': {
    program: traceTracedShader(8, [4, 4], false),
    entry: 'traceTriangles',
    entries: () => traceTracedEntries(false),
    cards: TRACE_TRACED_HIT.cards,
  },
  'the screen probes’ scene stage through the scene’s triangles, the fog on its rays': {
    program: traceTracedShader(8, [4, 4], true),
    entry: 'traceTriangles',
    entries: () => traceTracedEntries(true),
    cards: TRACE_TRACED_HIT.cards,
  },
  'the radiance cache’s trace': {
    program: CACHE_TRACE_PROGRAM,
    entry: 'traceTiles',
    entries: () => cacheTraceEntries(undefined, false),
    cards: CACHE_TRACE_HIT.cards,
  },
  'the radiance cache’s trace through the scene’s triangles': {
    program: CACHE_TRACED_PROGRAM,
    entry: 'traceTiles',
    entries: () => cacheTracedLayouts()[0],
    cards: CACHE_TRACED_HIT.cards,
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

test('the programs fit WebGPU’s default limits, the scene stage with the reflection group it reads beside it', () => {
  const { device } = fakeDevice()
  const reflection = reflectionSceneLayout(device)
  for (const [name, { entries }] of Object.entries(PROGRAMS)) {
    const layouts = [
      device.createBindGroupLayout({ entries: entries() as GPUBindGroupLayoutEntry[] }),
    ]
    if (name.includes('scene stage')) layouts.push(reflection)
    if (name.includes('triangles'))
      layouts.push(
        device.createBindGroupLayout({
          entries: cacheTracedLayouts()[1] as GPUBindGroupLayoutEntry[],
        }),
      )
    const descriptor = { bindGroupLayouts: layouts }
    device.createPipelineLayout(descriptor)
    const counts = stageBindingCounts(descriptor)
    assert.ok(counts.length > 0, name)
    for (const { limit, kind, count } of counts)
      assert.ok(count <= limitOf(limit), `${name}: ${count} ${kind}, past ${limitOf(limit)}`)
  }
})

test('the scene stages reach no binding of the reflection group but the ones of its reduced layout, the fog on their rays or not', () => {
  // The depth pyramid and the lit image are the screen's trace's and the pixels': a scene stage that reads them fails here, not on a device.
  const { entries } = reflectionSceneLayout(fakeDevice().device) as unknown as {
    entries: GPUBindGroupLayoutEntry[]
  }
  const held = new Set(entries.map(({ binding }) => binding))
  for (const fog of [false, true]) {
    const stages = {
      'the marched scene stage': [traceSceneShader(8, [4, 4], fog, [], undefined, false), ['traceScene', 'traceFar']],
      'the scene stage through the scene’s triangles': [
        traceTracedShader(8, [4, 4], fog),
        ['traceTriangles'],
      ],
    } as const
    for (const [name, [program, points]] of Object.entries(stages))
      for (const [binding, variable] of reachedBindings(program, points, REFLECTION_GROUP))
        assert.ok(
          held.has(binding),
          `${name}${fog ? ' with the fog' : ''} reaches ${variable} (${binding}) of the reflection group, the scene layout holds none`,
        )
  }
})
