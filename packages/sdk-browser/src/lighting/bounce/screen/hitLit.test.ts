// The screen probes' hit lighting (`hitLitWgsl.ts`, `hitLitStage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { hitLightingOf } from '../../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { singleBounceLightWord } from '../../reflections/hitLighting/listPasses.ts'
import { HIT_LIGHT_MODE } from '../../reflections/hitLighting/constants.ts'
import { reservedNames } from '../../../gpu/core/wgslNames.fixture.ts'
import {
  probeLitCompactProgram,
  probeLitDirectProgram,
  probeLitFinishProgram,
} from './hitLitWgsl.ts'
import { probeHitLitOf, releaseProbeHitLit } from './hitLitStage.ts'
import type { LitListResources } from '../../reflections/hitLighting/listPasses.ts'
import type { CacheHitLighting } from '../cache/cacheHitLit.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { hitLightingProbesRun } from '../../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { SP_LIT_MARK, traceTracedShader } from './traceTracedWgsl.ts'

const hit = (over = {}) =>
  hitLightingOf({
    reflectionHardwareRayTracingHitLighting: false,
    reflectionHardwareRayTracingBucketMaterials: true,
    hardwareRayTracingLightingMode: 'hitLighting',
    hardwareRayTracingHitLightingAllowed: true,
    hardwareRayTracingHitLightingDirectLighting: true,
    hardwareRayTracingHitLightingShadowMode: 'soft',
    hardwareRayTracingHitLightingSkylight: 'standalone',
    hardwareRayTracingHitLightingReflectionCaptures: true,
    hardwareRayTracingHitLightingForceOpaque: false,
    hardwareRayTracingHitLightingShadowTranslucencyMode: 'masked',
    reflectionMaxBounces: 5,
    reflectionRayTracedTranslucentRefractions: true,
    reflectionMaxRefractionBounces: 3,
    rayTracingLightGridResolution: 256,
    rayTracingLightGridMaxCount: 128,
    rayTracingLightGridAxis: -1,
    ...over,
  })

test('the probes light their hits only in the hit lighting mode, with one bounce, no refraction and no reflection capture whatever the reflections ask', () => {
  assert.equal(hitLightingProbesRun(hit()), true)
  assert.equal(
    hitLightingProbesRun(hit({ hardwareRayTracingLightingMode: 'hitLightingForReflections' })),
    false,
  )
  const word = singleBounceLightWord(hit())
  assert.equal((word >> HIT_LIGHT_MODE.bouncesShift) & 127, 1)
  assert.equal((word >> HIT_LIGHT_MODE.refractionsShift) & 127, 0)
  assert.equal(word & HIT_LIGHT_MODE.captures, 0)
  assert.equal(word & 3, 2)
  assert.ok((word & HIT_LIGHT_MODE.direct) !== 0)
})

test('the hit lighting a view kept is given back when the mode turns off, and the view counts it in its bytes', () => {
  let disposed = 0
  const kept = { dispose: () => disposed++, bytes: 64 } as unknown as LitListResources
  const state = { hitLit: kept, resources: {} } as unknown as Parameters<typeof probeHitLitOf>[1]
  const off = hit({ hardwareRayTracingLightingMode: 'hitLightingForReflections' })
  const none = probeHitLitOf(
    {} as GPUDevice,
    state,
    {} as ScreenProbeSettings,
    { settings: off } as CacheHitLighting,
    {} as SceneRays,
    {} as Parameters<typeof probeHitLitOf>[5],
    (() => undefined) as unknown as Parameters<typeof probeHitLitOf>[6],
  )
  assert.equal(none, undefined)
  assert.equal(disposed, 1)
  assert.equal(state.hitLit, undefined)
  releaseProbeHitLit(state)
  assert.equal(disposed, 1)
})

test('the stage that casts through the triangles marks a hit on a triangle with its material key and lights nothing from the cards', () => {
  const marking = traceTracedShader(8, [4, 4], false, undefined, undefined, true)
  const plain = traceTracedShader(8, [4, 4], false)
  assert.match(
    marking,
    new RegExp(
      `spTracedMark=${SP_LIT_MARK}u\\|\\(litMaterialKey\\(hit\\.placement,hit\\.record\\)&0x7fffu\\)`,
    ),
  )
  assert.ok(!marking.includes('out.radiance=tracedHitLight'))
  assert.ok(marking.includes('if(ray.hit&&spTracedMark==0u){ray.radiance+=spSkyLeak'))
  assert.ok(plain.includes('if(ray.hit){ray.radiance+=spSkyLeak'))
  assert.ok(plain.includes('out.radiance=tracedHitLight') && !plain.includes('spTracedMark'))
})

test('the compaction keeps the rays whose end is not left to the radiance cache and whose texel is marked, with the distance of the hit', () => {
  const text = probeLitCompactProgram(8, [4, 4])
  assert.match(
    text,
    /word==SP_FAR_PENDING\|\|\(textureLoad\(marks,texel,0\)\.r&4160749568u\)!=4160749568u/,
  )
  assert.match(text, /bitcast<u32>\(spHitDistance\(word\)\)/)
})

test('no packed light, a blue of two or more included, carries the mark', () => {
  // The brightest word packLight writes: each channel at its largest field (blue 30<<5|31 in the top ten bits).
  const brightest = ((30 << 5) | 31) * 2 ** 22 + (((30 << 6) | 63) << 11) + ((30 << 6) | 63)
  assert.notEqual((brightest & SP_LIT_MARK) >>> 0, SP_LIT_MARK)
  assert.equal(((0x7fff | SP_LIT_MARK) & SP_LIT_MARK) >>> 0, SP_LIT_MARK)
})

test('the first pass casts the ray again as the stage cast it, from a hair short of the hit, and a sun shadow ray runs the furthest a probe looks', () => {
  const text = probeLitDirectProgram(8, [4, 4])
  assert.match(text, /let flags=stAvoidFlags\(u32\(sp\.tracedHit\.z\)\);/)
  assert.match(text, /litSunReach\(\)->f32\{return spMaxTrace\(\);\}/)
  assert.match(
    text,
    /litBackFaceEnds\(hit:StHit\)->bool\{return !hit\.frontFace&&!hit\.twoSided;\}/,
  )
  assert.match(text, /fn litPath\(/)
})

test('the second pass reads the cards for their indirect light, adds the leaking sky light, fogs only where asked and dithers by the tile noise', () => {
  const dry = probeLitFinishProgram(8, [4, 4], false)
  const fogged = probeLitFinishProgram(8, [4, 4], true)
  assert.match(dry, /spSkyLeak\(direction,found\)/)
  assert.ok(!dry.includes('spRayFogged(radiance') && fogged.includes('spRayFogged(radiance'))
  assert.match(dry, /ditherLight\(lit,noise\)/)
  assert.match(dry, /scConeTangent\(look\.cone\)\*hitCm/)
})

test('the passes name no reserved word', () => {
  for (const text of [
    probeLitCompactProgram(8, [4, 4]),
    probeLitDirectProgram(8, [4, 4]),
    probeLitFinishProgram(8, [4, 4], true),
  ]) {
    assert.deepEqual(reservedNames(text), [])
  }
})

test('the probes’ lights are strengthened under the exposure of the view’s image (its own word of the parameters), held under its pre-exposure in the first pass and divided out in the second, which writes a finite light', () => {
  const direct = probeLitDirectProgram(8, [4, 4])
  const finish = probeLitFinishProgram(8, [4, 4], true)
  assert.match(direct, /let exposure=bitcast<f32>\(sp\.lit\.y\);/)
  for (const text of [direct, finish])
    assert.match(text, /fn litScale\(\)->f32\{return max\(view\.preExposure\.x,1\.0e-6\);\}/)
  assert.match(finish, /radiance\+=base\.xyz\/litScale\(\);/)
  assert.match(finish, /let lit=makeFinite3\(spRayFogged\(/)
})
