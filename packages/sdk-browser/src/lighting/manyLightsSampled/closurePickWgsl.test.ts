import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { CLOSURE_RULES } from '../../../../sdk-core/src/contracts/closureOptions.ts'
import { closureOffsetsOf } from '../../materials/surface/closureOffsets.ts'
import { FULL_CONTRACT } from '../deferred/contractCuts.ts'
import { TILE_CLASSES } from '../deferred/tileClass.ts'
import { STOCHASTIC_CLOSURES_WORD, closureStatements } from './closurePickWgsl.ts'
import { SAMPLED_PARAMS_WORDS, writeSampledParams } from './paramsWgsl.ts'
import { samplingWgsl } from './samplingWgsl.ts'
import { shadingWgsl } from './shadingWgsl.ts'
import { spatialWgsl } from './spatialWgsl.ts'
import { litPixelStatements, CLASS_CUTS } from '../deferred/litSurfaceWgsl.ts'
import { TILE_CLASS } from '../deferred/tileClass.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { SAMPLED_LIGHTS_RULES } from '../../../../sdk-core/src/contracts/sampledLightsOptions.ts'
import { sampledGeometry } from './layout.ts'

const WITH = { ...FULL_CONTRACT, closures: true }

// The CPU mirrors of the shader's choice (`pickedClosure`, `pickedPdf`), of the closures a pixel holds and of the sums.
const countOf = (offsets: number, held: number) => {
  if (held < 2) return 1
  let count = 1
  for (let k = 1; k < held; k++) if (((offsets >>> (4 * k)) & 15) !== 0) count = k + 1
  return count
}
const pick = (count: number, noise: number) =>
  count < 2 ? 0 : Math.min(Math.floor(count * noise), count - 1)
const pdf = (count: number) => (count > 1 ? 1 / count : 1)

test('the closures of a pixel are counted from its offsets word, held to the record', () => {
  for (let n = 1; n <= 8; n++) assert.equal(countOf(closureOffsetsOf(n), 8), n)
  assert.equal(countOf(closureOffsetsOf(5), 3), 3, 'held to the closures the record has')
  assert.equal(countOf(closureOffsetsOf(4), 1), 1, 'a record of one closure holds one')
})

test('the pick is uniform over the closures, in range, and its chance is one over their count', () => {
  for (let count = 2; count <= 8; count++) {
    const hits = new Array<number>(count).fill(0)
    const steps = 8000
    for (let i = 0; i < steps; i++) hits[pick(count, (i + 0.5) / steps)]!++
    for (const h of hits) assert.ok(Math.abs(h / steps - 1 / count) < 1e-3, `${count}`)
    assert.equal(pick(count, 1), count - 1, 'a noise of one is held to the last closure')
    assert.equal(pick(count, 0), 0)
    assert.equal(pdf(count), 1 / count)
  }
  assert.equal(pick(1, 0.9), 0)
  assert.equal(pdf(1), 1)
})

test('the stochastic estimate divides by the chance of the pick, so its mean is the summed light', () => {
  const weights = [0.6, 0.3, 0.1]
  const lights = [2, 5, 11]
  const summed = weights.reduce((a, w, k) => a + w * lights[k]!, 0)
  let mean = 0
  const steps = 3000
  for (let i = 0; i < steps; i++) {
    const k = pick(3, (i + 0.5) / steps)
    mean += (weights[k]! * lights[k]!) / pdf(3) / steps
  }
  assert.ok(Math.abs(mean - summed) < 1e-2)
})

test('the shader holds the same pick, chance, count and sums as the mirrors', () => {
  const code = wgslModule(shadingWgsl(WITH, TILE_CLASS.complex, false))
  assert.ok(
    code.includes(
      'min(u32(f32(settledCount)*blueNoiseScalar(vec2u(coord),params.frame)),settledCount-1u)',
    ),
  )
  assert.ok(
    code.includes('select(1.0,1.0/f32(settledCount),settledCount>1u&&stochasticClosures())'),
  )
  // The count, the pick and the weights are worked out once for the pixel last asked, not for each light.
  assert.ok(code.includes('if(all(coord==settledAt)){return;}'))
  assert.ok(code.includes('weighed[k]=closureWeightAt(coord,k);'))
  assert.ok(code.includes('if(((offsets>>(4u*k))&15u)!=0u){count=k+1u;}'))
  assert.ok(
    code.includes('pickedScale(closurePixel)/pickedPdf(closurePixel)'),
    'weight over chance',
  )
  assert.ok(code.includes('pixelWeight(closurePixel,k)'), 'the summed closures are weighed')
  assert.ok(code.includes('closureTone(coord,albedo,base.a,normal.a,N,V,true)'))
  assert.ok(code.includes('textureLoad(colours,coord,pickedBaseLayer(coord),0)'))
  assert.ok(
    code.includes('pickedNormalLayer(at)'),
    'the neighbours are read as their picked closure',
  )
})

test('the sampling weighs the light by the closures, and the spatial filter puts the picked colours back', () => {
  for (const tileClass of TILE_CLASSES) {
    const code = wgslModule(samplingWgsl(WITH, tileClass, false))
    assert.ok(code.includes('fn closureLuminance('), tileClass)
    assert.ok(code.includes('var luminance=closureLuminance(rank,'))
    assert.ok(code.includes('closurePixel=coord;'))
  }
  const spatial = spatialWgsl(false, true)
  assert.ok(spatial.includes('closureTone(coord,base.rgb,base.a,normal.a,N,V,false)'))
  assert.ok(spatial.includes('pickedNormalLayer(c)'))
  assert.ok(spatial.includes('var blueNoiseMask'), 'the blue noise the pick reads')
})

test('a view of one closure keeps the texts: nothing of the closures is in them', () => {
  for (const tileClass of TILE_CLASSES) {
    for (const code of [
      wgslModule(samplingWgsl(FULL_CONTRACT, tileClass, false)),
      wgslModule(shadingWgsl(FULL_CONTRACT, tileClass, false)),
    ]) {
      assert.ok(!/closurePixel|pickedClosure|closureTone|closureSplit|closureLuminance/.test(code))
    }
  }
  const plain = spatialWgsl()
  assert.ok(!/closurePixel|pickedClosure|closureTone/.test(plain))
})

test('the pixel statements swap the colour loads and refuse a text that moved', () => {
  const lit = litPixelStatements(CLASS_CUTS[TILE_CLASS.complex])
  const swapped = closureStatements(lit)
  assert.ok(
    swapped.includes('pickedBaseLayer(coord)') && swapped.includes('pickedNormalLayer(coord)'),
  )
  assert.throws(() => closureStatements('let x=1;'), /LIT_PIXEL_COLOUR_LOADS_MOVED/)
})

test('the setting is off by default, and the uniform carries it in the word the shader reads', () => {
  assert.equal(CLOSURE_RULES.stochasticClosureLighting.default, false)
  const settings = resolveSettings(SAMPLED_LIGHTS_RULES, {})
  const g = sampledGeometry(1920, 1080, [2, 2], [2, 2])
  for (const on of [false, true]) {
    const out = writeSampledParams(new ArrayBuffer(SAMPLED_PARAMS_WORDS * 4), g, settings, {
      frame: 3,
      history: false,
      historyTiles: g.tiles,
      textured: false,
      previousViewProjection: new Array(16).fill(0),
      fastClear: false,
      soft: false,
      specularOnly: false,
      lightCount: 4,
      stochasticClosures: on,
    })
    assert.equal(new Uint32Array(out)[STOCHASTIC_CLOSURES_WORD], on ? 1 : 0)
  }
})

test('the lights of a closure past the first are lit with its own specular and lobes, and the picked closure is read through its own flags and lobes texel', () => {
  for (const tileClass of TILE_CLASSES) {
    const lobed = CLASS_CUTS[tileClass].lobes
    for (const code of [
      wgslModule(samplingWgsl(WITH, tileClass, false)),
      wgslModule(shadingWgsl(WITH, tileClass, false)),
    ]) {
      // Each closure of the sum enters its own state, and the first closure's is restored after the sum.
      assert.ok(code.includes('enterClosure(closurePixel,k,s.N,V);'), String(tileClass))
      assert.ok(code.includes('enterClosure(closurePixel,0u,N,V);'), String(tileClass))
      assert.ok(code.includes('surfaceSpecular=closureSpecularAt(coord,closure);'))
      assert.equal(
        code.includes('lobes.on=false;'),
        lobed,
        `${tileClass}: the lobes are the pass's own`,
      )
      assert.equal(code.includes('lobesAt(texel,1.0,N,V,normal.a);'), lobed)
    }
  }
  // The stochastic pick reads the flags and the lobes of the picked closure.
  const swapped = closureStatements(litPixelStatements(CLASS_CUTS[TILE_CLASS.complex]))
  assert.ok(swapped.includes('let surfaceFlag=closureFlagsAt(coord,pickedClosure(coord));'))
  assert.ok(
    swapped.includes(
      'lobesAt(select(textureLoad(physicalLobes,coord),closureLobesTexel(coord,pickedClosure(coord)),pickedClosure(coord)>0u),1.0,N,V,normal.a);',
    ),
  )
  // The tone the light is demodulated by takes each closure's specular.
  assert.ok(spatialWgsl(false, true).includes('surfaceSpecular=closureSpecularAt(coord,k);'))
})
