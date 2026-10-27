// The screen probes' scene stage cast through the scene's triangles (`traceTracedWgsl.ts`): the program assembles and binds clear of the
// cut's tables, follows the reference ray step by step, leaves the rays that hit nothing to the radiance cache's answer, and its
// numbers reach the parameters.
import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { DAG_BINDING } from '../../../geometry/dag/shader/bindings.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { withinDefaults } from '../../../gpu/core/stageLimits.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { SELF_INTERSECTION } from '../../surfaceCache/lighting/layout.ts'
import { IMAGE_READS } from './imageReads.fixture.ts'
import { createScreenProbeParams } from './params.ts'
import { screenProbeFlags } from './modeFlags.ts'
import {
  SCREEN_PROBE_FLAGS,
  SCREEN_PROBE_PARAMS,
  SCREEN_PROBE_PARAMS_BYTES,
  screenProbeGeometry,
} from './screenProbeLayout.ts'
import { traceSceneShader } from './traceSceneWgsl.ts'
import {
  TRACE_TRACED_BINDINGS,
  TRACE_TRACED_FOG,
  TRACE_TRACED_HIT,
  TRACE_TRACED_SCENE,
  traceTracedEntries,
  traceTracedSceneEntries,
  traceTracedShader,
} from './traceTracedWgsl.ts'
import { reflectionSceneLayout } from '../../reflections/reflectionPipelines.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'

const PROGRAM = traceTracedShader(8, [4, 4], false)
const FOG_PROGRAM = traceTracedShader(8, [4, 4], true)

/** What an image with all of it can read, its thicknesses the traced stage's tests are written at. */
const READS = { ...IMAGE_READS, relativeThickness: 0.03, historyThickness: 0.004 }

test('the traced scene stage assembles: its names declared once, none reserved, the braces paired', () => {
  assertProgramAssembles(PROGRAM, 'traceTriangles')
  assertProgramAssembles(FOG_PROGRAM, 'traceTriangles')
})

test('the traced stage binds clear of the cut’s tables, which keep the culling’s bindings, and the scene trace in its own group', () => {
  const T = TRACE_TRACED_BINDINGS.at
  const cut = [
    DAG_BINDING.nodes,
    DAG_BINDING.worlds,
    DAG_BINDING.frames,
    DAG_BINDING.tree,
    DAG_BINDING.previous,
  ]
  // The layers of the cards their library declares and the layout leaves out lie between the cards' first binding and the last layer a hit reads.
  const library = Array.from({ length: 8 }, (_, at) => TRACE_TRACED_HIT.cards + at)
  const own = [
    ...Object.values(T),
    TRACE_TRACED_HIT.cards,
    TRACE_TRACED_HIT.cards + 1,
    TRACE_TRACED_HIT.cards + 7,
    TRACE_TRACED_HIT.instances,
    ...Object.values(TRACE_TRACED_FOG),
  ]
  for (const binding of cut) assert.ok(!own.includes(binding), `binding ${binding}`)
  assert.equal(new Set(own).size, own.length, 'no binding twice')
  for (const binding of Object.values(TRACE_TRACED_FOG))
    assert.ok(
      !library.includes(binding),
      `the fog’s binding ${binding} is clear of the cards’ layers`,
    )
  for (const fog of [false, true]) {
    const held = traceTracedEntries(fog).map(({ binding }) => binding)
    assert.equal(new Set(held).size, held.length, 'the layout holds no binding twice')
    for (const binding of cut) assert.ok(held.includes(binding), `the cut’s table ${binding}`)
    for (const binding of Object.values(TRACE_TRACED_FOG))
      assert.equal(
        held.includes(binding),
        fog,
        `the fog’s binding ${binding} is held only where it is on`,
      )
  }
  assert.deepEqual([TRACE_TRACED_SCENE.group, TRACE_TRACED_SCENE.first], [2, 0])
  assert.match(PROGRAM, /@group\(2\) @binding\(0\) var<uniform> stParams/)
  // The global distance field is neither marched nor bound.
  assert.doesNotMatch(PROGRAM, /gdf|Gdf|scGlobalHit/)
  assert.match(traceSceneShader(8, [4, 4], false), /gdfTraceRay/)
})

test('the traced stage’s group, the reflection group it reads and the scene trace’s hold to the sampled textures, the storage buffers and the storage textures a stage allows, with the fog on the rays or not', () => {
  // The stage binds the reflection group of the scene stages (`reflectionSceneLayout`) and the scene trace's beside its own.
  const group = reflectionSceneLayout(fakeDevice().device)
  for (const fog of [false, true])
    withinDefaults(
      [
        {
          bindGroupLayouts: [
            { entries: traceTracedEntries(fog) },
            group,
            { entries: traceTracedSceneEntries() },
          ] as unknown as GPUBindGroupLayout[],
        },
      ],
      `the traced stage${fog ? ' with the fog' : ''}`,
    )
})

test('the hit’s placement has a speed to measure only where a pose moved since the last drawn frame: the flag says so, and the stage skips the pose reads else', () => {
  assert.match(
    PROGRAM,
    /if\(spFlag\(SP_FLAG_POSES_MOVING\)\)\{out\.speed=length\(stHitVelocity\(hit\.placement,/,
  )
  const F = SCREEN_PROBE_FLAGS
  const settings = screenProbeSettings()
  assert.equal(screenProbeFlags(settings, { ...READS, posesMoving: false }) & F.posesMoving, 0)
  assert.equal(
    screenProbeFlags(settings, { ...READS, posesMoving: true }) & F.posesMoving,
    F.posesMoving,
  )
})

test('the ray starts as the reference starts it: off the surface along the normal, no nearer than the bias, pulled back only if it did not reach its end', () => {
  const ray = PROGRAM.slice(PROGRAM.indexOf('fn spTracedRay('), PROGRAM.indexOf('@compute'))
  const steps = [
    'var rayBias=sp.traced.x;',
    'if(probe.hair){rayBias=max(rayBias,sp.traced.z);}',
    'var tMin=max(missed,rayBias);',
    'let tMax=max(reach,rayBias);',
    'if(!(tMin<tMax)){return out;}',
    'tMin=max(tMin-sp.traced.w,rayBias);',
    'let origin=spTracedStart(probe,d);',
  ]
  let at = -1
  for (const step of steps) {
    const found = ray.indexOf(step)
    assert.ok(found > at, `${step} follows the step before it`)
    at = found
  }
  assert.match(ray, /hit=stTrace\(StRay\(origin-view\.display\.yzw,d,tMin,tMax,flags\)\);/)
  assert.equal(ray.match(/stTrace\(/g)?.length, 1, 'one call site')
  assert.match(ray, /var flags=ST_SKIP_TRANSLUCENT;/)
  assert.doesNotMatch(ray, /ST_SHADOW/)
})

test('the ray starts off the surface along its normal by the normal bias, the normal turned toward a ray that goes the other way on a probe with backface diffuse light', () => {
  const { spTracedStart } = shaderRun<{ spTracedStart: (probe: object, d: Vec3) => Vec3 }>(
    PROGRAM,
    ['spTracedStart'],
    { sp: { traced: [0, 0.25, 0, 0] } },
  )
  const probe = (foliage: boolean) => ({ P: [1, 2, 3], N: [0, 1, 0], foliage })
  assert.deepEqual(spTracedStart(probe(false), [0, 1, 0]), [1, 2.25, 3])
  assert.deepEqual(
    spTracedStart(probe(false), [0, -1, 0]),
    [1, 2.25, 3],
    'a plain surface keeps its normal',
  )
  assert.deepEqual(
    spTracedStart(probe(true), [0, -1, 0]),
    [1, 1.75, 3],
    'a sheet’s normal faces the ray',
  )
})

test('the self-intersection modes are the reference’s: 0 culls the back faces, 1 traces again once, 2 passes the near hits', () => {
  assert.deepEqual(SELF_INTERSECTION, { cull: 0, retrace: 1, skip: 2 })
  for (const [name, value] of [
    ['SP_AVOID_CULL', 0],
    ['SP_AVOID_RETRACE', 1],
    ['SP_AVOID_SKIP', 2],
  ] as const)
    assert.match(PROGRAM, new RegExp(`const ${name}:u32=${value}u;`))
  assert.match(PROGRAM, /if\(avoid==SP_AVOID_CULL\)\{flags\|=ST_CULL_BACK;\}/)
  assert.match(PROGRAM, /if\(avoid>=SP_AVOID_SKIP\)\{flags\|=ST_SKIP_NEAR;\}/)
  assert.match(PROGRAM, /if\(avoid!=SP_AVOID_RETRACE\|\|!hit\.hit\|\|trace==1u\)\{break;\}/)
  assert.match(
    PROGRAM,
    /hit\.distance<stParams\.skipTwoSidedDistance\)\{past=hit\.distance\+0\.01\/f32\(BOUNCE_CM\);\}/,
  )
  assert.match(
    PROGRAM,
    /!hit\.frontFace&&hit\.distance<stParams\.skipBackFaceDistance\)\{past=stParams\.skipBackFaceDistance;\}/,
  )
})

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
  const light = PROGRAM.match(/fn tracedHitLight\([\s\S]*?\n\}/)![0]
  assert.match(
    light,
    /if\(\(!hit\.frontFace&&!hit\.twoSided\)\|\|hitCm<nearest\)\{return vec3f\(0\.0\);\}/,
  )
  assert.match(
    light,
    /scEvaluateMeshCards\(placement,origin\*f32\(BOUNCE_CM\)\+d\*hitCm,hit\.normal,scConeTangent\(side\)\*hitCm,depthBias,false,coord\)/,
  )
  assert.match(light, /scPlacementMeshCards\(scHitPlacement\(hit\.object\)\)/)
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
  assert.match(entry, /let noise=blueNoiseVec2\(spProbeTile\(own\),sp\.mode\.w\)\.y;/)
  assert.match(
    entry,
    /let lit=spTracedLit\(ray,probe,direction\);[^]*packLight\(ditherLight\(lit,noise\)\)/,
  )
  assert.match(entry, /spHitWord\(end,moving\),0u,0u,0u/)
  // A hit moves when the probe's speed and the speed of the placement met differ, over the probe's depth, by more than the setting's share.
  assert.match(
    entry,
    /let moving=abs\(probe\.speed-ray\.speed\)\/max\(probe\.depth,1\.0\)>sp\.motion\.x;/,
  )
  assert.match(
    PROGRAM,
    /out\.speed=length\(stHitVelocity\(hit\.placement,origin-view\.display\.yzw\+d\*hit\.distance,stParams\.eyeXY,stEyeZ\(\)\)\);/,
  )
  // The march’s stage answers the marked rays alone, and clears the mark.
  const march = traceSceneShader(8, [4, 4], false)
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
