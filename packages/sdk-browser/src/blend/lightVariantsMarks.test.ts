// The shadow marks the translucent programs read where a surface asks for shadow reads of its own, and the light
// buffer's header word they find the forward light by (`lightVariants.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { coversTranslucentShadow, translucentShadowOf } from './pipelines.ts'
import { blendShader } from './shader.ts'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { transmitWgsl } from './transmission/transmitWgsl.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { LIGHT_HEADER_FORWARD } from '../../../sdk-core/src/scene/light/contracts.ts'
import { TRANSLUCENT_SHADOW_DEFAULT } from '../lighting/direct/shadowWgsl.ts'

// A surface that asks for shadow reads of its own (`translucentLocalLightShadow` and the two after
// it) marks them in its item's flags (`TRANSLUCENT_SHADOW_FLAG_SHIFT`); the program of a scene that
// holds such a surface reads the marks, the program of any other holds none of that code.
test('the programs of a scene whose surfaces ask nothing hold none of the marks’ code; those of a scene that asks read them', () => {
  const asked = { local: true, localTrace: false, directionalTrace: true }
  const marks = /translucentShadowBits=\(in\.ids\.y>>22u\)&7u;/
  const read = blendShader(
    {},
    { translucentShadow: { ...TRANSLUCENT_SHADOW_DEFAULT, materials: asked } },
  )
  const stage = transmitWgsl({}, false, undefined, undefined, true)
  const readStage = blendShader(
    {},
    { stage, translucentShadow: { ...TRANSLUCENT_SHADOW_DEFAULT, materials: asked } },
  )
  assert.match(read, marks)
  assert.match(readStage, /translucentShadowBits=\(flags>>22u\)&7u;/)
  for (const plain of [blendShader({}), blendShader({}, { stage: transmitWgsl({}, false) })])
    assert.doesNotMatch(plain, /translucentShadowBits/)
  // The vertex stage hands the marks from the record's model word to the item's flags.
  assert.match(wgslModule(blendVertexWgsl(true)), /\|\(\(\(m\.model>>6u\)&7u\)<<22u\)/)
})

test('what a scene asks of its own is read off its surfaces; programs made for less are made again', () => {
  const surface = (asked: object) => ({ surface: asked, transmissive: false }) as never
  const none = translucentShadowOf([
    surface({}),
    surface({ translucentLocalLightShadowQuality: 0 }),
  ])
  assert.deepEqual(none, { local: false, localTrace: false, directionalTrace: false })
  const asked = translucentShadowOf([
    surface({ translucentLocalLightShadow: true }),
    surface({ translucentDirectionalLightShadowQuality: 0.5 }),
  ])
  assert.deepEqual(asked, { local: true, localTrace: false, directionalTrace: true })
  assert.equal(
    coversTranslucentShadow(undefined, none),
    true,
    'a scene that asks nothing is served',
  )
  assert.equal(coversTranslucentShadow(none, asked), false)
  assert.equal(coversTranslucentShadow(asked, asked), true)
  assert.equal(
    coversTranslucentShadow({ ...asked, localTrace: true }, asked),
    true,
    'more serves less',
  )
  assert.equal(coversTranslucentShadow({ ...asked, local: false }, asked), false)
})

test('the light buffer’s header word the translucent fragments find the forward light by is the one the store writes', () => {
  const header = /struct DirectLights\{((?:\w+:u32,){4})/.exec(blendShader({}))![1]
  assert.equal(header.split(',')[LIGHT_HEADER_FORWARD], 'forwardRank:u32')
})
