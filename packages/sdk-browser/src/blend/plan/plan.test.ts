import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { planPipeline } from './plan.ts'
import { PLAN_PIPELINE_MASK } from './planEntry.ts'
import { planVertexCull } from '../expand/expandCpu.fixture.ts'
import { blendSceneOf } from './plan.fixture.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import type { BlendGpuItem } from '../state.ts'
import { surfaceOf, type PageSurface } from '../../geometry/pages/surface.ts'
import {
  chromaRank,
  transmitBase,
  WATER_BASE,
  pipelineBase,
  planCull,
  refractsRank,
  transmitsRank,
  waterRank,
  lightingOf,
  variantOf,
  variantOfBlend,
} from './planCull.ts'
import { BLEND_LIGHTINGS } from '../../materials/surface/blendLightSource.ts'
import { SURFACE_MODEL } from '../../materials/surface/surfaceModelWord.ts'

/** The blend plan of a lone item, everything but its material left at its simplest. */
function plan(material: PageSurface | PageSurface[], { transmissive = false } = {}) {
  const blendState = blendSceneOf([
    {
      transmissive,
      surface: surfaceOf(material),
      matrix: new Matrix4(),
    } as unknown as BlendGpuItem,
  ])
  return [...blendState.seeds]
}

test('an item that declares no material plans the host default side: one front entry, not a crash', () => {
  const front = plan(G.basicSurface({ side: G.FRONT_SIDE }))
  assert.equal(front.length, 1)
  assert.deepEqual(plan([]), front, 'an empty material array declares nothing: front')
})

// An entry picks the pipelines of its item's mode in the lighting program that lights it — three culls per variant, normal first.
test('an item plans on the pipelines of its blend mode; a mode no path draws is refused', () => {
  const pipelineOf = (blending: Blending | undefined, transmissive = false) =>
    plan(Object.assign(G.basicSurface({ transparent: true }), { blending }), { transmissive }).map(
      planPipeline,
    )
  // The basic surface is unlit: the mode's pipelines in the unlit lighting program.
  const variants = (blending: Blending) => pipelineOf(blending).map(variantOf)
  assert.deepEqual(variants('normal'), [variantOfBlend('normal', 'unlit')])
  for (const mode of ['additive', 'multiply', 'alphaComposite'] as const)
    assert.deepEqual(variants(mode), [variantOfBlend(mode, 'unlit')])
  assert.deepEqual(pipelineOf('normal', true), [
    transmitBase(false, false) + (pipelineOf('normal')[0] % 3),
  ])
  assert.throws(() => pipelineOf(undefined), /blending no path draws/)
  // The mode that once covered without mixing was deleted: it is refused by name, never drawn as normal.
  assert.throws(() => pipelineOf('none' as never), /blending no path draws/)
  assert.throws(() => pipelineOf('additive', true), /cannot use additive/)
})

test('a double-sided item plans one entry on the pipeline that culls nothing, as every two-sided surface draws', () => {
  const entries = plan(G.basicSurface({ side: G.DOUBLE_SIDE }))
  assert.deepEqual(entries.map(planCull), [0])
  assert.deepEqual(entries.map(planPipeline), [pipelineBase('normal', 'unlit')])
  assert.deepEqual(entries.map(planVertexCull), [0])
})

test('a double-sided item that asks two passes plans back then face on the pipeline that culls nothing', () => {
  const entries = plan(G.basicSurface({ side: G.DOUBLE_SIDE, twoSidedPasses: true }))
  // Back first: the pass culls the face (1), then the back (2); the vertex stage applies both.
  assert.deepEqual(entries.map(planCull), [1, 2])
  assert.deepEqual(entries.map(planPipeline), Array(2).fill(pipelineBase('normal', 'unlit')))
  assert.deepEqual(entries.map(planVertexCull), [1, 2])
})

test('a double-sided transmissive item plans back then face as a blend does, on its own pipelines', () => {
  const entries = plan(G.basicSurface({ side: G.DOUBLE_SIDE, twoSidedPasses: true }), {
    transmissive: true,
  })
  assert.deepEqual(entries.map(planCull), [1, 2])
  assert.deepEqual(entries.map(planPipeline), [
    transmitBase(false, false),
    transmitBase(false, false),
  ])
  assert.deepEqual(entries.map(planVertexCull), [1, 2])
})

test('a transmissive item plans by whether it refracts and whether its transmittance may differ by channel', () => {
  const kind = (patch: object) =>
    plan(Object.assign(G.basicSurface({}), patch), { transmissive: true }).map(planPipeline)[0]
  const cull = kind({}) % 3
  assert.equal(kind({}), transmitBase(false, false) + cull, 'grey: one blend over')
  assert.equal(kind({ refracts: true }), transmitBase(true, false) + cull)
  assert.equal(kind({ baseColor: [1, 0.5, 0.5] }), transmitBase(false, true) + cull, 'tinted')
  assert.equal(kind({ map: {} }), transmitBase(false, true) + cull, 'a map gives it per pixel')
  assert.equal(kind({ vertexColors: true }), transmitBase(false, true) + cull)
  assert.equal(kind({ graph: {} }), transmitBase(false, true) + cull, 'a graph gives it per pixel')
  // A surface edited in place moves rank at the next plan: the plan reads the record, not a copy.
  const edited = Object.assign(G.basicSurface({}), { baseColor: [0.5, 0.5, 0.5] })
  const ranks = (surface: PageSurface) => plan(surface, { transmissive: true }).map(planPipeline)[0]
  assert.equal(ranks(edited), transmitBase(false, false) + cull)
  edited.baseColor = [1, 0.5, 0.5]
  assert.equal(ranks(edited), transmitBase(false, true) + cull, 'tinted by an edit')
  assert.equal(
    kind({ baseColor: [0.5, 0.5, 0.5], refracts: true }),
    transmitBase(true, false) + cull,
  )
  assert.equal(kind({ baseColor: [1, 0.5, 0.5], refracts: true }), transmitBase(true, true) + cull)
  for (const [refracts, chromatic] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const) {
    const rank = transmitBase(refracts, chromatic)
    assert.equal(transmitsRank(rank), true)
    assert.equal(refractsRank(rank), refracts)
    assert.equal(chromaRank(rank), chromatic)
  }
})

test("a double-sided item of another mode sets that mode's pipeline that culls nothing", () => {
  const entries = plan(
    G.basicSurface({
      side: G.DOUBLE_SIDE,
      twoSidedPasses: true,
      transparent: true,
      blending: 'additive',
    }),
  )
  assert.deepEqual(entries.map(planCull), [1, 2])
  assert.deepEqual(entries.map(planPipeline), Array(2).fill(pipelineBase('additive', 'unlit')))
  assert.deepEqual(entries.map(planVertexCull), [1, 2])
})

test('a single-layer water plans on the pipelines past the refracting ones’, which no other pass takes for its own', () => {
  const entries = plan(
    Object.assign(G.basicSurface({ side: G.DOUBLE_SIDE, twoSidedPasses: true }), { water: true }),
  )
  assert.deepEqual(entries.map(planPipeline), [WATER_BASE, WATER_BASE])
  assert.deepEqual(entries.map(planCull), [1, 2])
  assert.equal(
    WATER_BASE,
    transmitBase(true, true) + 3,
    'three culls past the chromatic refracting layers',
  )
  for (const rank of [WATER_BASE, WATER_BASE + 1, WATER_BASE + 2]) {
    assert.equal(waterRank(rank), true)
    assert.equal(transmitsRank(rank), false, 'not a transmissive layer')
    assert.equal(refractsRank(rank), false, 'nor a refracting one')
  }
  assert.equal(waterRank(transmitBase(true, true) + 2), false)
  assert.equal(transmitsRank(transmitBase(true, true)), true)
  assert.ok(WATER_BASE + 2 <= PLAN_PIPELINE_MASK, 'a rank fits the plan entry’s seven bits')
})

// The lighting program an item is drawn in is its pipeline rank's: the plan sets it, the draw binds it, so a layer lit by the declared
// lights, by the volume, by nothing, or not at all never shares a draw with a layer of another lighting.
test('an item plans on the pipelines of the lighting program that lights it', () => {
  const rankOf = (surface: object, transmissive = false) =>
    variantOf(
      plan(Object.assign(G.basicSurface({ transparent: true }), surface), { transmissive }).map(
        planPipeline,
      )[0],
    )
  const forward = { lit: true, translucencyLighting: 'forward' }
  const volume = { lit: true, translucencyLighting: 'volume', blending: 'normal' }
  assert.equal(rankOf(forward), variantOfBlend('normal', 'forward'))
  assert.equal(rankOf(volume), variantOfBlend('normal', 'volume'))
  // A volume mode lights a normal or additive layer alone: a multiply layer is lit by nothing.
  assert.equal(rankOf({ ...volume, blending: 'multiply' }), variantOfBlend('multiply', 'lightless'))
  assert.equal(rankOf({ ...forward, lit: false }), variantOfBlend('normal', 'unlit'))
  assert.equal(
    rankOf({ ...forward, model: SURFACE_MODEL.shadow }),
    variantOfBlend('normal', 'forward'),
  )
  // A transmissive layer lights itself: its own ranks, whatever the mode.
  assert.ok(
    transmitsRank(
      plan(Object.assign(G.basicSurface({ transparent: true }), forward), {
        transmissive: true,
      }).map(planPipeline)[0],
    ),
  )
  for (const lighting of BLEND_LIGHTINGS)
    assert.equal(lightingOf(pipelineBase('normal', lighting) + 2), lighting)
})
