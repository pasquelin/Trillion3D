// `world.effects`: an ordered chain whose every change — a pass added, moved out, or one
// of its settings written — counts one revision and asks for a frame, and whose passes an engine
// reads per stage, in chain order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from './chain.ts'
import { effect } from './index.ts'
import { createWorldEffects } from './defaultChain.ts'
import { Bloom } from './bloom.ts'

test('passes run in the order they were added, or at the index given', () => {
  const chain = new EffectChain()
  const first = effect.bloom(),
    second = effect.bloom(),
    third = effect.bloom()
  chain.add(first).add(third).add(second, 1)
  assert.deepEqual(chain.passes, [first, second, third])
  assert.equal(chain.size, 3)
  assert.deepEqual(chain.stage('before-tone-mapping'), [first, second, third])
  assert.deepEqual(chain.stage('after-tone-mapping'), [], 'bloom runs before tone mapping')
  assert.equal(chain.stage('before-tone-mapping'), chain.stage('before-tone-mapping'), 'kept')
})

test('every change counts one revision and asks for a frame; a setting reaches the chain', () => {
  let asked = 0
  const chain = new EffectChain(() => void asked++)
  const bloom = effect.bloom()
  chain.add(bloom)
  bloom.intensity = 0.5
  bloom.sizeScale = 2
  assert.equal(chain.remove(bloom), true)
  bloom.intensity = 0.2 // out of the chain: nothing to redraw
  assert.equal(chain.remove(bloom), false)
  chain.clear() // already empty: no change
  assert.deepEqual([chain.revision, asked], [4, 4])
  chain.add(bloom)
  chain.clear()
  assert.deepEqual([chain.size, chain.revision], [0, 6])
  assert.deepEqual(chain.stage('before-tone-mapping'), [], 'the stage list follows the change')
})

test('a pass belongs to one chain; an index outside the chain and a foreign pass are refused', () => {
  const a = new EffectChain(),
    b = new EffectChain()
  const bloom = effect.bloom()
  a.add(bloom)
  assert.throws(() => b.add(bloom), /EFFECT_IN_A_CHAIN/)
  assert.throws(() => b.add(effect.bloom(), 1), /EFFECT_INDEX:1/)
  assert.throws(() => b.add({ kind: 'bloom' } as never), /EFFECT_UNKNOWN/)
  a.remove(bloom)
  b.add(bloom)
  assert.deepEqual([a.size, b.size], [0, 1])
})

test('bloom takes its defaults and refuses a value outside its range', () => {
  const bloom = effect.bloom()
  assert.deepEqual([bloom.intensity, bloom.threshold, bloom.sizeScale], [0.675, -1, 4], 'defaults')
  assert.deepEqual(
    bloom.levels.map(({ size }) => size),
    [0.3, 1, 2, 10, 30, 64],
  )
  assert.deepEqual(
    bloom.levels.map(({ tint }) => tint[0]),
    [0.3465, 0.138, 0.1176, 0.066, 0.066, 0.061],
  )
  assert.equal(bloom.stage, 'before-tone-mapping')
  assert.equal(effect.bloom({ intensity: 1, sizeScale: 3 }).sizeScale, 3)
  assert.throws(() => effect.bloom({ intensity: -1 }), /BLOOM_INTENSITY/)
  assert.throws(() => (bloom.intensity = Number.NaN), /BLOOM_INTENSITY/)
  assert.throws(() => (bloom.threshold = -2), /BLOOM_THRESHOLD/)
  assert.throws(() => (bloom.sizeScale = -0.5), /BLOOM_SIZE_SCALE/)
  assert.throws(() => effect.bloom({ sizeScale: Infinity }), /BLOOM_SIZE_SCALE/)
  assert.throws(() => effect.bloom({ levels: [{ size: -1 }] }), /BLOOM_SIZE:0/)
  assert.throws(() => effect.bloom({ levels: [{}, {}, { tint: [1, -1, 1] }] }), /BLOOM_TINT:2/)
  assert.throws(() => effect.bloom({ levels: new Array(7).fill({}) }), /at most 6 levels/)
})

test('a level, a tint or a field left out keeps its default; a write names what it changes', () => {
  const bloom = effect.bloom({ levels: [{}, { size: 5, tint: 0.5 }] })
  assert.deepEqual(
    [bloom.levels[0].size, bloom.levels[1].size, bloom.levels[1].tint, bloom.levels[2].size],
    [0.3, 5, [0.5, 0.5, 0.5], 2],
  )
  bloom.levels = [{ size: 0 }, {}, { tint: [1, 0, 0] }]
  assert.deepEqual(
    [bloom.levels[0].size, bloom.levels[1].size, bloom.levels[2].tint, bloom.levels[5].size],
    [0, 5, [1, 0, 0], 64],
  )
})

test('a bloom of intensity 0 is idle: the engine passes it by', () => {
  const bloom = effect.bloom()
  assert.equal(bloom.idle, false)
  bloom.intensity = 0
  assert.equal(bloom.idle, true)
})

test('a world starts with the default bloom in its chain, which one can remove', () => {
  let asked = 0
  const chain = createWorldEffects(() => void asked++)
  const [bloom] = chain.passes
  assert.deepEqual([chain.size, chain.revision, asked], [1, 0, 0], 'a start is no change')
  assert.ok(bloom instanceof Bloom)
  assert.deepEqual([bloom.intensity, bloom.threshold, bloom.sizeScale], [0.675, -1, 4])
  assert.deepEqual(chain.stage('before-tone-mapping'), [bloom])
  chain.clear()
  assert.deepEqual([chain.size, chain.revision, asked], [0, 1, 1], 'a removal is')
})
