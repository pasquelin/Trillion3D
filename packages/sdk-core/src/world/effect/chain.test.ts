// `world.effects`: an ordered chain whose every change — a pass added, moved out, or one
// of its settings written — counts one revision and asks for a frame, and whose passes an engine
// reads per stage, in chain order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectChain } from './chain.ts'
import { effect } from './index.ts'
import { createWorldEffects } from './defaultChain.ts'
import { Bloom } from './bloom.ts'
import { MotionBlur } from './motionBlur.ts'
import { BLOOM_QUALITY_STAGES, BLOOM_RULES } from '../../contracts/bloomRules.ts'
import { resolveSetting, resolveSettings } from '../../contracts/settingRules.ts'

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

test('the bloom has two methods, a convolution and a dirt mask, off by the reference’s defaults', () => {
  const bloom = effect.bloom()
  assert.deepEqual([bloom.method, bloom.gaussianIntensity], ['gaussian', 1])
  const { convolution, dirtMask } = bloom
  assert.deepEqual(
    [convolution.intensity, convolution.scatterDispersion, convolution.size, convolution.kernel],
    [1, 1, 1, undefined],
  )
  assert.deepEqual(
    [convolution.preFilterMin, convolution.preFilterMax, convolution.preFilterMult],
    [7, 15000, 15],
  )
  assert.equal(convolution.bufferScale, 0.133)
  assert.deepEqual(
    [dirtMask.image, dirtMask.intensity, [...dirtMask.tint]],
    [undefined, 0, [0.5, 0.5, 0.5]],
  )
  assert.throws(
    () => effect.bloom({ method: 'fft' as never }),
    /method must be one of gaussian, convolution/,
  )
  assert.throws(() => effect.bloom({ gaussianIntensity: -1 }), /BLOOM_GAUSSIAN_INTENSITY/)
  assert.throws(() => effect.bloom({ convolution: { size: -1 } }), /size: must be/)
  assert.throws(() => effect.bloom({ dirtMask: { intensity: -1 } }), /intensity: must be/)
  assert.throws(() => effect.bloom({ dirtMask: { tint: [1, 2] as never } }), /BLOOM_DIRT_TINT/)
  assert.throws(
    () => effect.bloom({ dirtMask: { image: { width: 0, height: 4 } } }),
    /dirtMask.image/,
  )
  const wrong = { width: 2, height: 2, pixels: new Float32Array(3) }
  assert.throws(() => effect.bloom({ convolution: { kernel: wrong } }), /pixels a Float32Array/)
})

test('a write to the convolution or the dirt mask names what it changes, and the method decides what idles it', () => {
  const bloom = effect.bloom()
  const kernel = { width: 2, height: 2, pixels: new Float32Array(16) }
  bloom.convolution = { size: 0.5, kernel }
  bloom.convolution = { preFilterMult: 3 }
  assert.deepEqual(
    [bloom.convolution.size, bloom.convolution.kernel, bloom.convolution.preFilterMult],
    [0.5, kernel, 3],
  )
  bloom.convolution = { kernel: null }
  assert.equal(bloom.convolution.kernel, undefined, 'null takes the kernel away')
  // The engine draws no kernel of its own: the method is refused by name until the host gives one.
  assert.throws(() => (bloom.method = 'convolution'), /needs convolution.kernel/)
  assert.throws(() => effect.bloom({ method: 'convolution' }), /bloom: method 'convolution' needs/)
  bloom.convolution = { kernel }
  bloom.dirtMask = { intensity: 2 }
  assert.deepEqual([bloom.dirtMask.intensity, [...bloom.dirtMask.tint]], [2, [0.5, 0.5, 0.5]])
  // The Gaussian glow is idle at a Gaussian intensity of 0; the convolution at its own intensity of 0.
  bloom.gaussianIntensity = 0
  assert.equal(bloom.idle, true)
  bloom.method = 'convolution'
  assert.equal(bloom.idle, false, 'the Gaussian intensity is not the convolution’s')
  bloom.convolution = { intensity: 0 }
  assert.equal(bloom.idle, true)
})

test('the bloom is drawn at the reference’s defaults: all six levels, no cross, half the width', () => {
  assert.deepEqual(resolveSettings(BLOOM_RULES, {}), {
    bloomQuality: 'highest',
    bloomCross: 0,
    bloomScreenPercentage: 50,
    bloomApplyLocalExposure: true,
    bloomCacheKernel: true,
  })
  // A quality names how many of the six levels draw, the widest first: 3, 3, 4, 5 and 6.
  const levels = BLOOM_RULES.bloomQuality.choices
  assert.deepEqual(levels, ['off', 'lowest', 'low', 'medium', 'high', 'highest'])
  assert.deepEqual(Object.values(BLOOM_QUALITY_STAGES), [3, 3, 4, 5, 6])
  // Like the anti-aliasing level: true is the default, false is off, a stranger is refused.
  assert.equal(resolveSetting(BLOOM_RULES.bloomQuality, true), 'highest')
  assert.equal(resolveSetting(BLOOM_RULES.bloomQuality, false), 'off')
  assert.throws(
    () => resolveSetting(BLOOM_RULES.bloomQuality, 'q9' as never),
    /bloomQuality: must be one of 'off'/,
  )
  assert.throws(
    () => resolveSetting(BLOOM_RULES.bloomScreenPercentage, -1),
    /bloomScreenPercentage/,
  )
})

test('a world starts with the default motion blur and bloom in its chain, which one can remove', () => {
  let asked = 0
  const chain = createWorldEffects(() => void asked++)
  const [blur, bloom] = chain.passes
  assert.deepEqual([chain.size, chain.revision, asked], [2, 0, 0], 'a start is no change')
  assert.ok(blur instanceof MotionBlur)
  assert.ok(bloom instanceof Bloom)
  assert.deepEqual([bloom.intensity, bloom.threshold, bloom.sizeScale], [0.675, -1, 4])
  assert.deepEqual(chain.stage('after-resolve'), [blur], 'the blur runs on the resolved image')
  assert.deepEqual(chain.stage('before-tone-mapping'), [bloom])
  chain.clear()
  assert.deepEqual([chain.size, chain.revision, asked], [0, 1, 1], 'a removal is')
})

test('motion blur takes its defaults — the reference’s but a lighter amount — and refuses a value outside its range', () => {
  const blur = effect.motionBlur()
  assert.deepEqual(
    [blur.amount, blur.max, blur.targetFps, blur.cameraMotion],
    [0.2, 5, 30, true],
    'defaults',
  )
  assert.equal(blur.stage, 'after-resolve')
  assert.equal(effect.motionBlur({ amount: 1, targetFps: 0, max: 100 }).max, 100)
  assert.equal(effect.motionBlur({ cameraMotion: false }).cameraMotion, false)
  assert.throws(() => effect.motionBlur({ amount: 1.5 }), /amount.*from 0 to 1, got 1.5/)
  assert.throws(() => effect.motionBlur({ max: -1 }), /max.*from 0 to 100, got -1/)
  assert.throws(() => effect.motionBlur({ targetFps: 24.5 }), /targetFps.*whole number/)
  assert.throws(() => effect.motionBlur({ targetFps: 121 }), /targetFps.*from 0 to 120/)
  // No size test of an object's own motion since every surface is measured as the visibility
  // buffer's are: the per-object size option is gone.
  assert.equal('perObjectSize' in blur, false)
  assert.throws(() => (blur.amount = Number.NaN), /amount/)
  assert.throws(() => (blur.cameraMotion = 1 as never), /cameraMotion.*true or false/)
  assert.equal(
    effect.motionBlur({ amount: null, max: undefined }).amount,
    0.2,
    'null is the default',
  )
  // How the blur is drawn is the view's (`MOTION_BLUR_RULES`), not the pass's.
  for (const drawn of ['quality', 'halfResGather', 'halfResInput', 'separable', 'scatter'])
    assert.equal(drawn in blur, false, drawn)
})

test('a motion blur writes reach the chain, and it is idle where it blurs nothing', () => {
  let asked = 0
  const chain = new EffectChain(() => void asked++)
  const blur = effect.motionBlur()
  chain.add(blur)
  assert.equal(blur.idle, false)
  blur.max = 0.001
  assert.equal(blur.idle, true, 'the reference blurs nothing at a longest streak of 0.001')
  blur.max = 5
  blur.amount = 0
  assert.equal(blur.idle, true, 'nor at an amount of 0')
  blur.amount = 0.5
  blur.targetFps = 0
  assert.deepEqual([blur.idle, blur.targetFps], [false, 0])
  assert.deepEqual([chain.revision, asked], [6, 6], 'every write asks for a frame')
})

test('the passes on the resolved image come first in the order they were added', () => {
  const chain = new EffectChain()
  const first = effect.motionBlur(),
    second = effect.motionBlur({ amount: 0.2 }),
    bloom = effect.bloom()
  chain.add(bloom).add(first, 0).add(second)
  assert.deepEqual(chain.stage('after-resolve'), [first, second])
  assert.deepEqual(chain.stage('before-tone-mapping'), [bloom])
})

test('the depth of field takes the reference lens, is off until it has a focus or a depth blur, and runs before the temporal pass', () => {
  let asked = 0
  const chain = new EffectChain(() => void asked++)
  const dof = effect.depthOfField()
  chain.add(dof)
  assert.deepEqual([dof.kind, dof.stage, dof.idle], ['depthOfField', 'before-resolve', true])
  assert.deepEqual(
    [dof.aperture, dof.minAperture, dof.bladeCount, dof.sensorWidth, dof.squeezeFactor],
    [4, 1.2, 5, 24.576, 1],
  )
  dof.focusDistance = 5
  assert.equal(dof.idle, false)
  dof.focusDistance = 0
  dof.depthBlurRadius = 3
  assert.equal(dof.idle, false, 'a depth blur alone')
  dof.enabled = false
  assert.deepEqual([dof.idle, chain.revision, asked], [true, 5, 5], 'every write asks for a frame')
  assert.throws(() => effect.depthOfField({ aperture: 0.5 }), /aperture/)
  assert.throws(() => effect.depthOfField({ matteBox: [{ pitch: 91 }] }), /matteBox\[0\].pitch/)
  dof.matteBox = [{ length: 4 }, { roll: 90 }]
  assert.deepEqual(
    dof.matteBox.map((flag) => [flag.pitch, flag.roll, flag.length]),
    [
      [0, 0, 4],
      [0, 90, 0],
      [0, 0, 0],
    ],
  )
  // How it is drawn is the view's (`DEPTH_OF_FIELD_RULES`); no world starts with a depth of field.
  assert.equal('quality' in dof, false)
  const world = createWorldEffects()
  assert.ok(!world.passes.some((pass) => pass.kind === 'depthOfField'))
  // Added last, it runs first whatever its place in the chain: its own stage, ahead of the motion blur's.
  world.add(effect.depthOfField())
  assert.deepEqual(
    world.stage('before-resolve').map((pass) => pass.kind),
    ['depthOfField'],
  )
  assert.deepEqual(
    world.stage('after-resolve').map((pass) => pass.kind),
    ['motionBlur'],
  )
})
