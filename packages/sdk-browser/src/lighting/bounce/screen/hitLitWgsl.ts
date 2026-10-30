import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import { computeBufferEntry } from '../../../gpu/core/computeBindings.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { ditherLight, packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { FLAT_INDEX_WGSL } from '../../../gpu/dispatch/grid.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { lightFunctionLayoutEntry } from '../../lightFunction/bindings.ts'
import { lightProfileLayoutEntries } from '../../lightProfile/profileBindings.ts'
import { hitLightModeWgsl, LIT_SINGLE_VECS } from '../../reflections/hitLighting/constants.ts'
import {
  LIT_RESOLVE_WGSL,
  litPathWgsl,
  litScaleWgsl,
} from '../../reflections/hitLighting/pathWgsl.ts'
import {
  litDirectHostWgsl,
  litListWgsl,
  litPathHostOf,
} from '../../reflections/hitLighting/hostWgsl.ts'
import { LIT_THREADS } from '../../reflections/hitLighting/litWgsl.ts'
import { rayFogLayoutEntries } from '../../reflections/rayFog.ts'
import {
  NO_SCENE_MASKS,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneTraceAvoidWgsl } from '../../rays/sceneTrace/avoidWgsl.ts'
import { surfaceHitCardsLayoutEntries } from '../../surfaceCache/hitWgsl.ts'
import { VISUALIZE_MODE } from '../../surfaceCache/visualizeModes.ts'
import { BOUNCE_CM_WGSL, tracedCardLightWgsl, tracedLitCardsWgsl } from '../tracedHitWgsl.ts'
import { SP_RAY_CONE, SP_FAR_PENDING, spListedRays } from './traceSceneWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { rayFogWgsl } from './rayFogWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { spProbeRecords } from './probesWgsl.ts'
import {
  SP_LIT_MARK,
  SP_TRACED_START,
  TRACE_TRACED_FOG,
  TRACE_TRACED_HIT,
  TRACE_TRACED_SCENE,
} from './traceTracedWgsl.ts'
import { spRays } from './traceWgsl.ts'

/** The bindings the hit lighting's passes share with the stage that marks the hits (`traceTracedWgsl.ts`), and its own: the lists, the lights, the light functions' atlas and the light profiles'. */
const SHARED = {
  params: 0,
  info: 2,
  normal: 3,
  pixels: 4,
  ray: 5,
  radiance: 8,
  sceneRays: 12,
  blue: 13,
  hit: 14,
} as const
const OWN = {
  litList: 40,
  litSorted: 41,
  litRadiance: 42,
  lights: 43,
  litFunction: 44,
  litProfile: 45,
  litProfileSampler: 46,
} as const

/** The compaction's bindings (group 0): the probes' records, the list of the rays the screen left, the ends and the marks the stage wrote, and the list of the hits to light that it fills. */
export const PROBE_LIT_COMPACT = bindingTable({
  params: [SHARED.params, 'uniform'],
  info: [SHARED.info, 'float'],
  normal: [SHARED.normal, 'uint'],
  radiance: [SHARED.radiance, 'uint'],
  sceneRays: [SHARED.sceneRays, 'buffer-read'],
  hit: [SHARED.hit, 'uint'],
  litList: [OWN.litList, 'buffer'],
})

/** The first pass's bindings (group 0): the probes' records and the rays' words as the storage they are written through, the probes' pixels, the blue noise, the lists, the first pass's radiance and the lights. The cut's tables, the light functions' atlas and the light profiles' are beside them. */
export const PROBE_LIT_DIRECT = bindingTable({
  params: [SHARED.params, 'uniform'],
  info: [SHARED.info, { store: F.info, access: 'read-only' }],
  normal: [SHARED.normal, 'uint'],
  pixels: [SHARED.pixels, 'buffer-read'],
  ray: [SHARED.ray, { store: F.ray, access: 'read-only' }],
  blue: [SHARED.blue, 'float'],
  lights: [OWN.lights, 'buffer-read'],
  litList: [OWN.litList, 'buffer-read'],
  litSorted: [OWN.litSorted, 'buffer-read'],
  litRadiance: [OWN.litRadiance, 'buffer'],
})

/** The second pass's bindings (group 0): the records, the rays, the pixels and the noise, the lists, the first pass's radiance, and the trace's radiance it writes. The cards the hits read, and the lights and the fog's reads where the fog is laid over the rays, are beside them. */
export const PROBE_LIT_FINISH = bindingTable({
  params: [SHARED.params, 'uniform'],
  info: [SHARED.info, { store: F.info, access: 'read-only' }],
  normal: [SHARED.normal, 'uint'],
  pixels: [SHARED.pixels, 'buffer-read'],
  ray: [SHARED.ray, { store: F.ray, access: 'read-only' }],
  radiance: [SHARED.radiance, { store: F.trace }],
  blue: [SHARED.blue, 'float'],
  litList: [OWN.litList, 'buffer-read'],
  litSorted: [OWN.litSorted, 'buffer-read'],
  litRadiance: [OWN.litRadiance, 'buffer-read'],
})

/** The path as the probes cast it: the light functions' atlas as a read-only storage texture and the light profiles, the view's eye and pre-exposure, and the exposure of the image (`sp.lit.y`). */
export const PROBE_LIT_HOST = litPathHostOf(
  {
    lightFunction: OWN.litFunction,
    lightProfile: OWN.litProfile,
    lightProfileSampler: OWN.litProfileSampler,
  },
  'view.display.yzw',
  'bitcast<f32>(sp.lit.y)',
  'view.preExposure.x',
)

/** The cards the second pass reads: the surface cache's indirect light (the direct light is made at the hit), at the same bindings as the stage that marks the hits. */
export const PROBE_LIT_HIT = { ...TRACE_TRACED_HIT, visualize: VISUALIZE_MODE.indirectLighting }
/** The lights' binding of the second pass where the fog is laid over the rays, and the fog's reads (`TRACE_TRACED_FOG`). */
const FOG_LIGHTS = TRACE_TRACED_FOG.lights

/** The layouts of the passes' group 0. */
export const probeLitCompactEntries = () => PROBE_LIT_COMPACT.entries
export const probeLitDirectEntries = () => [
  ...PROBE_LIT_DIRECT.entries,
  ...dagReadLayoutEntries(),
  lightFunctionLayoutEntry(OWN.litFunction, undefined, true),
  ...lightProfileLayoutEntries(PROBE_LIT_HOST.lightProfile),
]
export const probeLitFinishEntries = (
  fog: boolean,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) => [
  ...PROBE_LIT_FINISH.entries,
  ...surfaceHitCardsLayoutEntries(PROBE_LIT_HIT, light),
  ...(fog ? [computeBufferEntry(FOG_LIGHTS, 'read-only-storage')] : []),
  ...rayFogLayoutEntries(TRACE_TRACED_FOG, fog),
]

/** The head of the program of every pass: the parameters, the side of the probes' rays and the probes' common words. */
const head = (side: number, samples: readonly [number, number]) => ({
  text: `${spParams(SHARED.params)}
${wgslConsts({ SP_TRACE: side })}`,
  common: spCommon(samples),
})

/**
 * THE COMPACTION OF THE HITS TO LIGHT (`spLitCompact`, a thread a ray the screen left, over the list the stage that casts through the triangles reads): the rays whose end that stage wrote (not `SP_FAR_PENDING`, which leaves a ray to the
 * radiance cache) and whose radiance texel it marked (`SP_LIT_MARK`, the top bits no packed light sets: a hit on a triangle, the low fifteen bits holding the key of its material, which is also what the sort reads in that texture) are appended to a list of the ray's texel
 * and the distance of its hit, as the reflections' compaction does for theirs.
 */
export const probeLitCompactProgram = (side: number, samples: readonly [number, number]) => {
  const C = PROBE_LIT_COMPACT.at
  const { text, common } = head(side, samples)
  return wgslProgram(text, [
    common,
    spProbeRecords(C.info, C.normal),
    spListedRays(C.sceneRays),
    SP_FAR_PENDING,
    wgslBlock(
      'SP_LIT_COMPACT',
      [],
      `struct LitList{count:atomic<u32>,entries:array<vec2u>,}
@group(0) @binding(${C.litList}) var<storage,read_write> litList:LitList;
@group(0) @binding(${C.hit}) var hitWords:texture_2d<u32>;
@group(0) @binding(${C.radiance}) var marks:texture_2d<u32>;
@compute @workgroup_size(WORKGROUP_THREADS)
fn spLitCompact(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let listed=spListed(id,groups);
 if(!listed.ok){return;}
 let texel=vec2i(listed.at);
 let word=textureLoad(hitWords,texel,0).r;
 if(word==SP_FAR_PENDING||(textureLoad(marks,texel,0).r&${SP_LIT_MARK}u)!=${SP_LIT_MARK}u){return;}
 let place=atomicAdd(&litList.count,1u);
 litList.entries[place]=vec2u(listed.at.x|(listed.at.y<<16u),bitcast<u32>(spHitDistance(word)));
}`,
    ),
  ])
}

/**
 * THE FIRST PASS (`spLitDirect`, a thread a hit of the sorted list): the ray of the hit's texel is cast again from just short of the hit (`litPath`, `reflections/hitLighting/pathWgsl.ts`), from where the stage that marked it started it
 * (`spTracedStart`) and as it avoided the geometry it started on (the culling and the skipping of the near hits, `surfaceCacheHardwareRayTracingAvoidSelfIntersections`); the hit's material, the lights and their shadow rays make its light,
 * a hit on the back of a surface that is not two-sided ending the path with none. The probes' rays have one bounce and no refraction, no reflection captures, and a shadow ray toward the sun runs as far as the
 * furthest a probe's ray looks (`screenProbeMaxTraceDistance`).
 */
export const probeLitDirectProgram = (
  side: number,
  samples: readonly [number, number],
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
) => {
  const D = PROBE_LIT_DIRECT.at
  const { text, common } = head(side, samples)
  return wgslProgram(text, [
    common,
    spProbeRecords(D.info, D.normal, true),
    spRays(D.ray, D.pixels, D.blue, true),
    FLAT_INDEX_WGSL,
    DIRECT_LIGHT_WGSL,
    SP_TRACED_START,
    hitLightModeWgsl('sp.lit.x'),
    sceneTraceAvoidWgsl(TRACE_TRACED_SCENE.group, TRACE_TRACED_SCENE.first, programs),
    litPathWgsl(PROBE_LIT_HOST),
    litListWgsl(D, LIT_SINGLE_VECS, true),
    litDirectHostWgsl({
      traceShare: '0.0',
      sunReach: 'spMaxTrace()',
      backFaceEnds: '!hit.frontFace&&!hit.twoSided',
    }),
    wgslBlock(
      `SP_LIT_DIRECT(${sceneMaskKey(programs)})`,
      [],
      `@group(0) @binding(${D.lights}) var<storage,read> directLights:DirectLights;
@compute @workgroup_size(${LIT_THREADS})
fn spLitDirect(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(thread,groups,${LIT_THREADS}u);
 if(at>=litList.count){return;}
 let entry=litSorted[at];
 let texel=vec2u(entry.x&0xffffu,entry.x>>16u);
 let atlas=texel/SP_TRACE;
 let index=spIndexOf(atlas);
 let probe=spReadProbe(atlas);
 let direction=spRayDirection(atlas,texel%SP_TRACE,index);
 let found=bitcast<f32>(entry.y);
 // The ray as the stage that marked the hit cast it: the culling and the skipping of the near hits as the setting avoids the geometry the ray starts on.
 let flags=stAvoidFlags(u32(sp.tracedHit.z));
 let rng=ptRandCreateDiffused(texel,sp.size.w,directLights.count,directLights.count+1u);
 litPath(at*LIT_FIRST_VECS,LitStart(direction,LitRay(spTracedStart(probe,direction),found+0.01,flags)),found,rng);
}`,
    ),
  ])
}

/**
 * THE SECOND PASS (`spLitFinish`, a thread a hit of the sorted list, in the program that reads the cards): the path's vertex is given the surface cache's indirect light at the hit, or the sky light's (`litResolve`,
 * `pathWgsl.ts`, the cards read over the footprint of the ray's cone, the hits nearer than `sp.tracedHit.y` centimetres bringing none), the sky light that leaks onto the hit is added (`spSkyLeak`), the height fog is laid over it
 * where `fog` (`spRayFogged`) and it is written dithered by the probe tile's blue noise, in the trace's radiance, as the stage that lights from the cards writes it. A path the first pass left invalid is black, and a sum that is not finite is taken to zero.
 */
export const probeLitFinishProgram = (
  side: number,
  samples: readonly [number, number],
  fog: boolean,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) => {
  const R = PROBE_LIT_FINISH.at
  const { text, common } = head(side, samples)
  return wgslProgram(text, [
    common,
    spProbeRecords(R.info, R.normal, true),
    spRays(R.ray, R.pixels, R.blue, true),
    SP_RAY_CONE,
    FLAT_INDEX_WGSL,
    SP_TRACED_START,
    BOUNCE_CM_WGSL,
    tracedCardLightWgsl(PROBE_LIT_HIT, light),
    ditherLight,
    packLight,
    hitLightModeWgsl('sp.lit.x'),
    LIT_RESOLVE_WGSL,
    litScaleWgsl(PROBE_LIT_HOST.scale),
    makeFinite3,
    litListWgsl(R, LIT_SINGLE_VECS, false),
    tracedLitCardsWgsl('sp.tracedHit.x', 'sp.tracedHit.y'),
    ...(fog ? [DIRECT_LIGHT_WGSL, rayFogWgsl(TRACE_TRACED_FOG)] : []),
    wgslBlock(
      `SP_LIT_FINISH(${fog})`,
      [],
      `${fog ? `@group(0) @binding(${FOG_LIGHTS}) var<storage,read> directLights:DirectLights;\n` : ''}@group(0) @binding(${R.radiance}) var radianceOut:texture_storage_2d<${F.trace},write>;
@compute @workgroup_size(${LIT_THREADS})
fn spLitFinish(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(thread,groups,${LIT_THREADS}u);
 if(at>=litList.count){return;}
 let entry=litSorted[at];
 let texel=vec2u(entry.x&0xffffu,entry.x>>16u);
 let atlas=texel/SP_TRACE;
 let t=texel%SP_TRACE;
 let index=spIndexOf(atlas);
 let probe=spReadProbe(atlas);
 let direction=spRayDirection(atlas,t,index);
 let found=bitcast<f32>(entry.y);
 let slot=at*LIT_FIRST_VECS;
 var radiance=vec3f(0.0);
 // A path the first pass left invalid (the cast again missed the hit) is black, a hit at the distance the stage found.
 if(litUnpack(litRadiance[slot].xy).w>=0.5){
  radiance=litResolve(slot,direction,LitHit(vec3f(0.0),vec3f(0.0,0.0,1.0),0u,found),LitLook(spRayCone(atlas,t),texel));
 }
 radiance+=spSkyLeak(direction,found);
 let lit=makeFinite3(${fog ? 'spRayFogged(radiance,spTracedStart(probe,direction),direction,found,true)' : 'radiance'});
 let noise=blueNoiseVec2(spProbeTile(index,probePixels[index]),sp.mode.w).y;
 textureStore(radianceOut,vec2i(texel),vec4u(packLight(ditherLight(lit,noise)),0u,0u,0u));
}`,
    ),
  ])
}
