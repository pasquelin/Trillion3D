// The screen probes' scene stage cast through the scene's triangles: how a hit is read and written, the numbers that reach its parameters and the height fog laid over a hit.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { SELF_INTERSECTION } from '../../surfaceCache/lighting/layout.ts'
import { IMAGE_READS } from './imageReads.fixture.ts'
import { createScreenProbeParams } from './params.ts'
import {
  SCREEN_PROBE_PARAMS,
  SCREEN_PROBE_PARAMS_BYTES,
  screenProbeGeometry,
} from './screenProbeLayout.ts'
import { traceSceneShader } from './traceSceneWgsl.ts'
import { TRACE_TRACED_FOG, traceTracedShader } from './traceTracedWgsl.ts'

const PROGRAM = traceTracedShader(8, [4, 4], false)
const FOG_PROGRAM = traceTracedShader(8, [4, 4], true)

/** What an image with all of it can read, its thicknesses the traced stage's tests are written at. */
const READS = { ...IMAGE_READS, relativeThickness: 0.03, historyThickness: 0.004 }

test('a hit is read as the reference reads it: only a stopped trace that held no hit is a black hit, one that held a hit keeps its light, a near or back-face hit brings nothing, the cards of the placement met give the light', () => {
  const ray = PROGRAM.slice(PROGRAM.indexOf('fn spTracedRay('), PROGRAM.indexOf('@compute'))
  assert.match(ray, /if\(!hit\.hit\)\{\n  out\.hit=!stComplete;\n  return out;\n \}/)
  assert.match(
    ray,
    /var out=SpTraced\(vec3f\(0\.0\),tMax,false,0\.0\);/,
    'the black hit sits at the ray’s end',
  )
  assert.doesNotMatch(
    ray,
    /if\(!stComplete\)\{/,
    'a stopped trace that held a hit is not forced black',
  )
  assert.doesNotMatch(ray, /select\(tMax,hit\.distance,hit\.hit\)/)
  assert.match(ray, /out\.hit=true;\n out\.distance=hit\.distance;/)
  assert.match(
    ray,
    /out\.radiance=tracedHitLight\(hit,origin,d,side,sp\.tracedHit\.x,sp\.tracedHit\.y,vec2u\(0u\)\);/,
  )
  // The hit's read is the text the world probes' rays share: a near or back-face hit brings nothing, the cards of the placement met give the light.
  // The hit's light hands the hit to the cards' read (`tracedCardLight`, shared with the scene view's traced rays), coarse pages.
  const light = PROGRAM.match(/fn tracedHitLight\([\s\S]*?\n\}/)![0]
  assert.match(
    light,
    /return tracedCardLight\(hit\.object,hit\.frontFace,hit\.twoSided,hitCm,origin\*f32\(BOUNCE_CM\)\+d\*hitCm,hit\.normal,scConeTangent\(side\)\*hitCm,depthBias,nearest,false,coord\)\.radiance;/,
  )
  const cards = PROGRAM.match(/fn tracedCardLight\([\s\S]*?\n\}/)![0]
  assert.match(
    cards,
    /if\(\(!frontFace&&!twoSided\)\|\|hitCm<nearest\)\{return ScHit\(vec3f\(0\.0\),false\);\}/,
  )
  assert.match(
    cards,
    /return scEvaluateMeshCards\(scPlacementMeshCards\(scHitPlacement\(object\)\),world,normal,radius,depthBias,hiRes,coord\);/,
  )
})

test('a hit writes its light dithered by the tile’s blue noise and its distance held to the furthest a ray looks; a miss leaves the ray to the radiance cache, its light untouched', () => {
  const entry = PROGRAM.slice(PROGRAM.indexOf('fn traceTriangles('))
  assert.match(entry, /let end=min\(ray\.distance,spMaxTrace\(\)\);/)
  const miss = entry.indexOf('if(!ray.hit){')
  const store = entry.indexOf('textureStore(radianceOut')
  assert.ok(miss > 0 && miss < store, 'the miss returns before the light is written')
  assert.match(
    entry.slice(miss, store),
    /textureStore\(hitIo,texel,vec4u\(SP_FAR_PENDING,0u,0u,0u\)\);/,
  )
  // The sky light that leaks onto a hit joins its light before it is written, at the distance the hit was found at.
  assert.match(entry, /if\(ray\.hit\)\{ray\.radiance\+=spSkyLeak\(direction,ray\.distance\);\}/)
  assert.match(entry, /let noise=blueNoiseVec2\(spProbeTile\(index,own\),sp\.mode\.w\)\.y;/)
  assert.match(
    entry,
    /let lit=spTracedLit\(ray,probe,direction\);[^]*packLight\(ditherLight\(lit,noise\)\)/,
  )
  assert.match(entry, /spHitWord\(end,moving\),0u,0u,0u/)
  // A hit moves when the probe's speed and the speed of the placement met differ, over the probe's depth, by more than the setting's share.
  assert.match(entry, /let moving=spHitMoving\(probe,ray\.speed\);/)
  assert.match(
    PROGRAM,
    /fn spHitMoving\(probe:SpProbe,speed:f32\)->bool\{return abs\(probe\.speed-speed\)\/max\(probe\.depth,1\.0\)>sp\.motion\.x;\}/,
  )
  assert.match(
    PROGRAM,
    /out\.speed=length\(stHitVelocity\(hit\.placement,origin-view\.display\.yzw\+d\*hit\.distance,stParams\.eyeXY,stEyeZ\(\)\)\);/,
  )
  // The march’s stage answers the marked rays alone, and clears the mark.
  const march = traceSceneShader(8, [4, 4], false, [], undefined, false)
  const far = march.slice(march.indexOf('fn traceFar('))
  assert.match(far, /if\(textureLoad\(hitIo,texel\)\.r!=SP_FAR_PENDING\)\{return;\}/)
  assert.match(far, /spHitWord\(far\.stored,false\)/)
  assert.match(march, /const SP_FAR_PENDING:u32=0xffffffffu;/)
})

test('the traced numbers reach the parameters, and the thickness scale is one only where the image casts through the triangles', () => {
  const held = new Uint32Array(SCREEN_PROBE_PARAMS.words)
  const device = {
    queue: {
      writeBuffer(_: unknown, __: number, image: Uint32Array, first: number, count: number) {
        held.set(image.subarray(first, first + count), first)
      },
    },
  } as unknown as GPUDevice
  const write = createScreenProbeParams(device, { size: SCREEN_PROBE_PARAMS_BYTES } as GPUBuffer)
  const settings = screenProbeSettings()
  const geometry = screenProbeGeometry(1920, 1080, settings)
  const rays = {
    depthBias: 10,
    minHitDistance: 10,
    selfIntersections: SELF_INTERSECTION.skip + 1,
    frame: 1,
  } as unknown as SceneRays
  const image = (casting?: SceneRays) => ({
    ...READS,
    rays: casting,
  })
  const at = SCREEN_PROBE_PARAMS.at
  const floats = (from: number) => Array.from(new Float32Array(held.buffer, from * 4, 4))
  write(geometry, settings, image(rays))
  assert.deepEqual(
    floats(at.traced),
    [0.001, 0.001, 0.02, 0.08].map(Math.fround),
    'a tenth of a centimetre of bias along the ray and off the surface, two centimetres for hair, eight of pull-back',
  )
  assert.deepEqual(
    floats(at.tracedHit),
    [10, 10, 3, 0].map(Math.fround),
    'the cards’ depth bias and the nearest hit that lights, in centimetres, and the self-intersection mode',
  )
  assert.equal(
    floats(at.trace)[0],
    1,
    'the rays cast through the triangles make the thickness scale one for every pixel',
  )
  write(geometry, settings, image())
  assert.deepEqual(floats(at.tracedHit), [0, 0, 0, 0])
  assert.equal(
    floats(at.trace)[0],
    2,
    'marched through the field: the pixels without a distance field are thicker by the setting’s scale',
  )
  write(geometry, screenProbeSettings({ screenProbeThicknessScaleWithoutField: 3 }), image())
  assert.equal(floats(at.trace)[0], 3, 'the scale is the setting’s')
  write(geometry, screenProbeSettings({ screenProbeThicknessScaleWithoutField: 3 }), image(rays))
  assert.equal(floats(at.trace)[0], 1, 'and one wherever the rays go through the triangles')
})

test('the switch and its numbers carry the reference defaults', () => {
  const { values } = screenProbeSettings()
  assert.deepEqual(
    [
      values.screenProbeHardwareRayTracing,
      values.screenProbeHardwareRayTracingBias,
      values.screenProbeHardwareRayTracingNormalBias,
      values.screenProbeHardwareRayTracingHairBias,
      values.hardwareRayTracingPullbackBias,
    ],
    [true, 0.001, 0.001, 0.02, 0.08],
  )
})

test('the height fog is laid over a hit from where the ray started over the distance it hit at, before the one dither; with the option off the program holds no fog code and no lights', () => {
  const entry = FOG_PROGRAM.slice(FOG_PROGRAM.indexOf('fn traceTriangles('))
  const miss = entry.indexOf('if(!ray.hit){')
  const leak = entry.indexOf('ray.radiance+=spSkyLeak(')
  const lit = entry.indexOf('let lit=spTracedLit(ray,probe,direction);')
  const store = entry.indexOf('textureStore(radianceOut')
  assert.ok(
    leak > 0 && leak < miss && miss < lit && lit < store,
    'a miss leaves the ray unfogged; a hit is fogged after the sky leak, before it is written',
  )
  assert.match(
    FOG_PROGRAM,
    /fn spTracedLit\(ray:SpTraced,probe:SpProbe,d:vec3f\)->vec3f\{\n return spRayFogged\(ray\.radiance,spTracedStart\(probe,d\),d,ray\.distance,true\);/,
  )
  assert.match(
    PROGRAM,
    /fn spTracedLit\(ray:SpTraced,probe:SpProbe,d:vec3f\)->vec3f\{\n return ray\.radiance;/,
  )
  assert.equal(entry.match(/packLight\(/g)?.length, 1, 'the light is quantized once')
  assert.match(
    FOG_PROGRAM,
    new RegExp(
      `@binding\\(${TRACE_TRACED_FOG.lights}\\) var<storage,read> directLights:DirectLights;`,
    ),
  )
  assert.doesNotMatch(PROGRAM, /reflectionFogged|spRayFogged|directLights/)
  // The fog is seen along the hit's own distance (not the end held to the furthest a ray looks), from the start.
  const seen: { from: Vec3; along: Vec3 }[] = []
  const { spRayFogged } = shaderRun<{
    spRayFogged: (light: Vec3, from: Vec3, d: Vec3, distance: number, hit: boolean) => Vec3
  }>(FOG_PROGRAM, ['spRayFogged'], {
    reflectionView: { light: [0, 0, 0, 1000] },
    reflectionFogged: (rgb: Vec3, from: Vec3, along: Vec3) => (seen.push({ from, along }), rgb),
  })
  spRayFogged([1, 1, 1], [1, 2.01, 3], [0, 1, 0], 7, true)
  assert.deepEqual(seen, [{ from: [1, 2.01, 3], along: [0, 7, 0] }])
})
