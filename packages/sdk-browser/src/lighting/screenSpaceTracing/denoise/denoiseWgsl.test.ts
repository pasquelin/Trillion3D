// The denoiser's programs assemble into one text each, with the entry the pipelines name, the bindings the layouts hold (each once), the
// kernels the signals need, and no character that breaks a template. The stochastic sets are the 56 of four offsets.
import test from 'node:test'
import assert from 'node:assert/strict'
import { screenReflectionsWgsl } from '../reflectionsWgsl.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../rayCastWgsl.ts'
import { DENOISE_BINDINGS as D, DENOISE_PARAMS_WORDS, writeDenoiseParams } from './denoiseView.ts'
import { denoiseSpatialWgsl } from './spatialWgsl.ts'
import { denoiseAccumulationWgsl } from './accumulationWgsl.ts'
import { keepWgsl } from './keepWgsl.ts'
import { STACKOWIAK_OFFSETS, STACKOWIAK_SET_COUNT } from './stackowiakSet.ts'

const entries = (code: string) => [...code.matchAll(/@compute[^{]*?\bfn (\w+)/g)].map((m) => m[1])
const bindings = (code: string) => [...code.matchAll(/@binding\((\d+)\)/g)].map((m) => Number(m[1]))

const programs = {
  'reflections reconstruction': denoiseSpatialWgsl('reflections', 'input'),
  'reflections pre-convolution': denoiseSpatialWgsl('reflections', 'history'),
  'indirect reconstruction': denoiseSpatialWgsl('indirect', 'input'),
  'reflections accumulation': denoiseAccumulationWgsl('reflections'),
  'indirect accumulation': denoiseAccumulationWgsl('indirect'),
  keep: keepWgsl(),
}

test('every program has its one compute entry and each binding once', () => {
  for (const [name, text] of Object.entries(programs)) {
    assert.deepEqual(entries(text), [name === 'keep' ? 'keepCompute' : 'denoiseCompute'], name)
    const all = bindings(text)
    assert.equal(new Set(all).size, all.length, name)
    assert.ok(!text.includes('`'), name)
    assert.ok(text.includes('@workgroup_size(8,8)'), name)
  }
})

test('the spatial passes read the signal and write the two outputs; the accumulation also the history and the last surface', () => {
  for (const name of [
    'reflections reconstruction',
    'reflections pre-convolution',
    'indirect reconstruction',
  ] as const) {
    const all = bindings(programs[name])
    for (const binding of [D.params, D.sourceA, D.sourceB, B.out, B.outSecond])
      assert.ok(all.includes(binding), name)
    assert.ok(!all.includes(D.historyA), name)
  }
  for (const name of ['reflections accumulation', 'indirect accumulation'] as const) {
    const all = bindings(programs[name])
    for (const binding of [D.historyA, D.historyB, D.prevDepth, D.prevNormals, B.out, B.outSecond])
      assert.ok(all.includes(binding), name)
  }
  const keep = bindings(programs.keep)
  assert.ok(keep.includes(D.keepDepth) && keep.includes(D.keepNormals))
})

test('the reflections draw an ellipse along the lobe; the indirect light reads the stochastic sets of the quad', () => {
  const reflections = programs['reflections reconstruction']
  assert.ok(reflections.includes('uniformDiskConcentric(hammersley16(i,total,seed))'))
  assert.ok(reflections.includes('dnBilateral(0u,false,true,'))
  assert.ok(!reflections.includes('stackowiak'))
  const indirect = programs['indirect reconstruction']
  assert.ok(indirect.includes(`array<vec2f,${STACKOWIAK_SET_COUNT * 4}>`))
  assert.ok(indirect.includes('dnBilateral(2u,true,false,'))
  assert.equal(STACKOWIAK_OFFSETS.length, STACKOWIAK_SET_COUNT * 8)
  // The first set is the four pixels of the quad.
  assert.deepEqual(STACKOWIAK_OFFSETS.slice(0, 8), [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5])
})

test('the accumulation clamps the history to 1.25 deviations and caps it at the targeted weight of the signal', () => {
  const reflections = programs['reflections accumulation']
  assert.ok(reflections.includes('1.25*deviation'))
  assert.ok(reflections.includes('dnLobeOnScreen(origin,screen)'))
  assert.ok(reflections.includes('1.0,1024.0)'))
  assert.ok(reflections.includes('dnBilateral(1u,false,true,'))
  const indirect = programs['indirect accumulation']
  assert.ok(indirect.includes('let targeted=128.0;'))
  assert.ok(indirect.includes('interleavedGradientNoise(center,dnParams.time.x)'))
  assert.ok(indirect.includes('dnBilateral(2u,true,false,'))
  // The history's weight is never negative (the reference lets a signal with more weight than its target subtract the history).
  assert.ok(indirect.includes('max(min(kept.n,targeted-current.n),0.0)'))
})

test('the denoiser variant of the trace writes the confusion factor and the plain one does not', () => {
  for (const code of [1, 2, 3, 4]) {
    const text = screenReflectionsWgsl(code, true)
    assert.ok(text.includes('confusionOut'))
    assert.ok(text.includes('@location(1) confusion'))
    assert.ok(text.includes('closest=min(closest,ssHitSquaredDistance(P,marched.hit))'))
    assert.ok(!screenReflectionsWgsl(code).includes('confusion'))
  }
  // The medium level casts glossy rays for the denoiser, and the single ray's second random number is held below 0.9.
  assert.ok(screenReflectionsWgsl(2, true).includes('E.y*=0.9;'))
  assert.ok(!screenReflectionsWgsl(2).includes('E.y*=0.9;'))
})

test('the parameters land in their fields', () => {
  const words = new Float32Array(DENOISE_PARAMS_WORDS)
  writeDenoiseParams(words, {
    width: 10,
    height: 6,
    ratio: 2,
    cut: true,
    maxSamples: 8,
    previousCumulative: 64,
    spread: 1,
    frame: 3,
    exposure: 0.5,
  })
  assert.deepEqual([...words], [10, 6, 2, 1, 8, 64, 1, 0, 3, 0.5, 0, 0])
})
