// `world.effects.blendables`: the post-process materials the image joins, ordered per location by priority, mixed by weight.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from './chain.ts'
import { material } from '../material/index.ts'
import { blendableOf, STENCIL_COMPARES } from '../material/postProcessMaterial.ts'

test('a post-process material starts from the reference defaults', () => {
  const m = material.postProcess()
  assert.equal(m.domain, 'postProcess')
  assert.deepEqual(blendableOf(m), {
    location: 'sceneColorAfterTonemapping',
    priority: 0,
    outputAlpha: false,
    isBlendable: true,
    disablePreExposureScale: false,
    stencilTest: false,
    stencilCompare: 'less',
    stencilRef: 0,
  })
})

test('a value a property does not take gives its default', () => {
  const m = material.postProcess({ blendableLocation: 'nowhere' as never, stencilRefValue: 900 })
  assert.equal(blendableOf(m).location, 'sceneColorAfterTonemapping')
  assert.equal(blendableOf(m).stencilRef, 255)
  assert.equal(STENCIL_COMPARES.length, 8)
})

test('the materials of a location run by priority, equal ones in the order they were added', () => {
  const chain = new EffectChain()
  const at = (priority: number, location = 'sceneColorBeforeBloom' as const) =>
    material.postProcess({ blendableLocation: location, blendablePriority: priority })
  const [a, b, c, d] = [at(2), at(1), at(1), at(0, 'sceneColorBeforeDof')]
  for (const m of [a, b, c, d]) chain.blendables.add(m)
  assert.deepEqual(
    chain.blendables.chainAt('sceneColorBeforeBloom').map((one) => one.material),
    [b, c, a],
  )
  assert.deepEqual(
    chain.blendables.chainAt('sceneColorBeforeDof').map((one) => one.material),
    [d],
  )
  assert.deepEqual(chain.blendables.chainAt('sceneColorAfterTonemapping'), [])
  assert.equal(
    chain.blendables.chainAt('sceneColorBeforeBloom'),
    chain.blendables.chainAt('sceneColorBeforeBloom'),
  )
})

test('a material that may not be blended is drawn as its own node; a write to a material redraws the image', () => {
  let asked = 0
  const chain = new EffectChain(() => void asked++)
  const m = material.postProcess({ isBlendable: false })
  chain.blendables.add(m, 0.5).add(m, 0.5)
  const after = asked
  const nodes = chain.blendables.chainAt('sceneColorAfterTonemapping')
  assert.equal(nodes.length, 2, 'each add is a node, none left out')
  assert.deepEqual(
    nodes.map((one) => one.weight),
    [0.5, 0.5],
    'the weights are not composed',
  )
  m.isBlendable = true
  assert.ok(asked > after, 'the material told the chain')
  assert.equal(chain.blendables.chainAt('sceneColorAfterTonemapping').length, 1)
})

test('a material added twice is one entry whose weights compose', () => {
  const chain = new EffectChain()
  const m = material.postProcess()
  chain.blendables.add(m, 0.5).add(m, 0.5)
  const [only, ...rest] = chain.blendables.chainAt('sceneColorAfterTonemapping')
  assert.equal(rest.length, 0)
  assert.equal(only.weight, 0.75)
})

test('only a post-process material is a blendable, with a weight above 0 and at most 1', () => {
  const chain = new EffectChain()
  assert.throws(() => chain.blendables.add(material.meshStandard()), TypeError)
  assert.throws(() => chain.blendables.add(material.postProcess(), 0), RangeError)
  assert.throws(() => chain.blendables.add(material.postProcess(), 1.5), RangeError)
  const m = material.postProcess()
  chain.blendables.add(m)
  assert.equal(chain.blendables.remove(m), true)
  assert.equal(chain.blendables.remove(m), false)
  assert.equal(chain.blendables.size, 0)
})
