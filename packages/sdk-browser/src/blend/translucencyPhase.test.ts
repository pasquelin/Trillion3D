// The passes of the translucency (`translucencyPasses.ts`, `translucencyPhase.ts`): the codes a
// surface's pass names, whether the image splits by them, the draws it makes, and the views of the
// expansion that give each draw the items of its own passes alone (`expand/expansionViews.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from '../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../sdk-core/src/world/effect/index.ts'
import { drawing } from '../frame/render/encodeEffects.fixture.ts'
import { layerDraws, splitsTranslucency } from './translucencyPhase.ts'
import { poolPasses, translucencyPassBit, translucencyPassCode } from './translucencyPasses.ts'
import { VIEW_COUNT, itemFilterWord, planFrameViews, slotMayDraw } from './expand/expansionViews.ts'
import { createWebgpuBlendState } from './state.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { BLEND_SHADER } from '../gpu/core/shaderTexts.fixture.ts'

/** Every pass's bit: the filter word's passes. */
const EVERY_PASS = poolPasses(
  (['beforeDepthOfField', 'afterDepthOfField', 'afterMotionBlur'] as const).map(
    (translucencyPass) => ({
      translucencyPass,
    }),
  ),
)

test('a surface names its pass; after the depth of field is the default', () => {
  assert.equal(translucencyPassCode(undefined), 2)
  assert.equal(translucencyPassCode('afterDepthOfField'), 2)
  assert.equal(translucencyPassCode('beforeDepthOfField'), 1)
  assert.equal(translucencyPassBit('beforeDepthOfField'), 2)
  assert.equal(translucencyPassBit('afterDepthOfField'), 4)
  assert.equal(translucencyPassCode('afterMotionBlur'), 3)
  assert.equal(translucencyPassBit('afterMotionBlur'), 8)
})

test('the image splits its layers by pass only with the depth of field drawn', () => {
  const chain = new EffectChain()
  const rt = drawing(chain)
  assert.equal(splitsTranslucency(rt), false, 'no depth of field: no split')
  const lens = effect.depthOfField({ focusDistance: 3 })
  chain.add(lens)
  assert.equal(splitsTranslucency(rt), true)
  Object.assign(rt.run, { diagnostic: 'wireframe' })
  assert.equal(splitsTranslucency(rt), false, 'a view that shows no effects has none')
})

test('with the depth of field drawn and layers in two passes, the draws are the pass before, then the others, each keeping its own', () => {
  const chain = new EffectChain()
  const rt = drawing(chain)
  const bit = translucencyPassBit
  rt.blendState.translucencyPasses = bit('beforeDepthOfField') | bit('afterDepthOfField')
  const lone = layerDraws(rt).map(({ at, active, only }) => [at, active, only])
  assert.deepEqual(
    lone,
    [
      [0, false, 0],
      [1, true, 0],
      [2, false, 0],
    ],
    'no depth of field: one draw of every layer',
  )
  chain.add(effect.depthOfField({ focusDistance: 3 }))
  const split = layerDraws(rt).map(({ at, active, only }) => [at, active, only])
  assert.deepEqual(split, [
    [0, true, bit('beforeDepthOfField')],
    [1, true, bit('afterDepthOfField')],
    [2, false, 0],
  ])
})

/** A blend state of items of pass codes `passes`, each expanding ten instances, the first `responsive` of them marking. */
function itemsOf(passes: number[], responsive = 0) {
  const blendState = createWebgpuBlendState()
  blendState.blendGpu.push(...passes.map(() => ({ sides: 1 }) as never))
  blendState.drawsPacked = new Uint32Array(passes.length * 4)
  passes.forEach((code, i) => {
    blendState.drawsPacked[i * 4 + 1] = 10
    blendState.drawsPacked[i * 4 + 3] = itemFilterWord(code, i < responsive)
  })
  blendState.instanceCapacity = 10 * passes.length
  blendState.translucencyPasses = passes.reduce((set, code) => set | (1 << code), 0)
  blendState.responsive = responsive > 0
  return blendState
}

test('each draw of a split image reads a view of the items of its passes, past the view of every layer in the instance list', () => {
  const chain = new EffectChain()
  chain.add(effect.depthOfField({ focusDistance: 3 }))
  const rt = drawing(chain)
  const blendState = itemsOf([1, 2, 2])
  Object.assign(rt, { blendState })
  planFrameViews(rt)
  const { frameViews: views, drawViews } = blendState
  assert.equal(views.length, VIEW_COUNT)
  assert.deepEqual([drawViews[0].colour, drawViews[1].colour], [1, 3])
  assert.deepEqual(
    views.map((view) => view.active),
    [true, true, false, true, false, false, false],
  )
  // The pass before leaves the others out and starts past view 0's block; the others follow it.
  const bit = translucencyPassBit
  assert.deepEqual(
    [views[1].exclude, views[1].instanceBase, views[3].exclude, views[3].instanceBase],
    [EVERY_PASS & ~bit('beforeDepthOfField'), 30, EVERY_PASS & ~bit('afterDepthOfField'), 40],
  )
  // No responsive item: no responsiveness view.
  assert.deepEqual([drawViews[0].responsive, drawViews[1].responsive], [-1, -1])
})

test('a draw that keeps every item reads the view of every layer, one that keeps none draws nothing', () => {
  const chain = new EffectChain()
  chain.add(effect.depthOfField({ focusDistance: 3 }))
  const rt = drawing(chain)
  const blendState = itemsOf([2, 2])
  Object.assign(rt, { blendState })
  // Pools of another pass make several draws, the items all in one.
  rt.context.particles = [{ translucencyPass: 'beforeDepthOfField' }] as never
  planFrameViews(rt)
  assert.deepEqual([blendState.drawViews[0].colour, blendState.drawViews[1].colour], [-1, 0])
  assert.equal(blendState.frameViews.filter((view) => view.active).length, 1)
})

test('a slot the CPU knows empty for a view is not drawn', () => {
  const blendState = itemsOf([1, 2])
  // Item 0 is of the main class (pipeline 5), item 1 draws its own slot, between two gaps.
  Object.assign(blendState, {
    seeds: Uint32Array.from([5, (1 << 8) | 7]),
    mainPipeline: 5,
    ownSeeds: Uint32Array.from([1]),
    slotOwns: Int32Array.from([-1, 0, -1]),
  })
  const draws = (view: number) => [0, 1, 2].map((slot) => slotMayDraw(blendState, view, slot))
  const keeps = (view: number, pass: 'beforeDepthOfField' | 'afterDepthOfField') =>
    Object.assign(blendState.frameViews[view], {
      exclude: EVERY_PASS & ~translucencyPassBit(pass),
    })
  keeps(1, 'beforeDepthOfField')
  // The view of the pass before keeps item 0 alone: the gaps stay, the other item's own slot goes.
  assert.deepEqual(draws(1), [true, false, true])
  keeps(2, 'afterDepthOfField')
  assert.deepEqual(draws(2), [false, true, false], 'the main class holds none of the pass after')
  assert.deepEqual(draws(0), [true, true, true], 'the view of every layer draws every slot')
})

test('a layer marks its pixels responsive where its opacity is above 0 and under the clip value plus a 255th', () => {
  const { blendResponsive } = shaderRun<{
    blendResponsive: (input: object, opacity: number) => number
  }>(BLEND_SHADER, ['blendResponsive'], {})
  const clip = Math.fround(0.3333)
  const view = (code: number) => ({
    words: { x: code << 28, y: new Uint32Array(new Float32Array([clip]).buffer)[0] },
  })
  // The code in thirds: none, a pixel animation, one whose history restarts.
  assert.deepEqual(
    [0, 1, 3].map((code) => blendResponsive(view(code), 0.2)),
    [0, 1 / 3, 1],
  )
  assert.equal(blendResponsive(view(3), 0), 0, 'a layer of no opacity hides nothing')
  assert.equal(blendResponsive(view(3), 0.3333 + 1 / 255 - 1e-4), 1)
  assert.equal(blendResponsive(view(3), 0.3333 + 1 / 255 + 1e-4), 0, 'past the window')
  assert.equal(blendResponsive(view(3), 1), 0, 'an opaque pixel of the layer marks none')
})
