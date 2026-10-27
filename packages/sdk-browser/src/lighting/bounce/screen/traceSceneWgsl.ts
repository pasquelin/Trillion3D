import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { ditherLight, packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import {
  surfaceHitBindingsFrom,
  surfaceHitLayoutEntries,
  surfaceHitWgsl,
} from '../../surfaceCache/hitWgsl.ts'
import { atlasEntry } from '../atlas.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { BOUNCE_CM_WGSL } from '../tracedHitWgsl.ts'
import { spCacheRead } from './cacheReadWgsl.ts'
import { SP_TARGET_DITHER, spCommon, spParams } from './commonWgsl.ts'
import { spProbeRecords, spReach } from './probesWgsl.ts'
import { rayFogLayoutEntries, type RayFogBindings } from '../../reflections/rayFog.ts'
import { rayFogWgsl } from './rayFogWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { spRays } from './traceWgsl.ts'

/** The scene stage's bindings: the probes' records and pixels, the ray words, the radiance and ends written (the ends read and
 *  written in place), the cascades' uniform, the lights (the sky they hold), the list of the rays the screen left, the engine's blue
 *  noise, and the radiance cache's maps. */
export const TRACE_SCENE_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, { store: F.info, access: 'read-only' }],
  normal: [2, 'uint'],
  pixels: [4, 'buffer-read'],
  ray: [5, { store: F.ray, access: 'read-only' }],
  radiance: [6, { store: F.trace }],
  hit: [7, { store: F.hit, access: 'read-write' }],
  bounceGrid: [8, 'uniform'],
  lights: [10, 'buffer-read'],
  sceneRays: [12, 'buffer-read'],
  blue: [17, 'float'],
  cacheFinal: [18, 'uint'],
  cacheRaw: [19, 'uint'],
  cacheSky: [20, 'float'],
})
/** The atlas of the cascades' probes, which the radiance cache's lookup reads the probes' table in. */
export const TRACE_SCENE_PROBES = 9
/** Where the stage reads what its hits find: the global field its rays are marched through, its object grid and the surface cache
 *  (`../../surfaceCache/hitWgsl.ts`), from binding 22. */
export const TRACE_SCENE_HIT = surfaceHitBindingsFrom(0, 22)
/** Where the stage reads the fog's cubemap and its sampler, where the height fog is laid over the light of its rays (`screenProbeHeightFogOnGI`). */
export const TRACE_SCENE_FOG: RayFogBindings = { cubemap: 38, sampler: 39 }
/** The layout of the scene stage's group 0, with the fog's reads where `fog` says. */
export const traceSceneEntries = (fog: boolean) => [
  ...TRACE_SCENE_BINDINGS.entries,
  atlasEntry(TRACE_SCENE_PROBES),
  ...surfaceHitLayoutEntries(TRACE_SCENE_HIT),
  ...rayFogLayoutEntries(TRACE_SCENE_FOG, fog),
]

const C = TRACE_SCENE_BINDINGS.at

/** The mark the hit word (`spHitWord`) of a ray holds when the traced stage (`traceTracedWgsl.ts`) left it to the radiance cache: `SP_FAR_PENDING`, all its bits set — a
 *  value no distance word holds, its exponent whole —, until `traceFar` answers it. */
export const SP_FAR_PENDING = wgslBlock('SP_FAR_PENDING', [], 'const SP_FAR_PENDING:u32=0xffffffffu;')

/** The width of the cone of a ray of the scene stage (`spRayCone`): the texels a side of the grid the ray's trace texel is a texel of. A program
 *  that names it declares the rays (`spRays`) and `SP_TRACE`. */
export const SP_RAY_CONE = wgslBlock(
  'SP_RAY_CONE',
  [],
  `fn spRayCone(atlas:vec2u,t:vec2u)->f32{
 if(!spFlag(SP_FLAG_IMPORTANCE)){return f32(SP_TRACE);}
 return f32(spRayMip(spRayLevel(spRayWordAt(vec2i(atlas*SP_TRACE+t))),SP_TRACE));
}`,
)

/**
 * THE LIST OF THE RAYS THE SCREEN LEFT, at `binding` of group 0, as a scene stage is dispatched over it: `spListed` is the ray a thread
 * stands for, its texel (the entry), its probe's atlas coordinate and record, `ok` false for a thread past the list or whose probe stands
 * on no lit surface. A program that names it declares the probes' records (`spProbeRecords`) and `SP_TRACE`.
 */
export const spListedRays = (binding: number) =>
  wgslBlock(
    `spListedRays(${binding})`,
    [
      listWgsl({ name: 'sceneRays', group: 0, binding, entry: 'u32', append: false }),
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
    `struct SpListed{ok:bool,at:vec2u,atlas:vec2u,probe:SpProbe,}
fn spListed(id:vec3u,groups:vec3u)->SpListed{
 var out=SpListed(false,vec2u(0u),vec2u(0u),SpProbe(vec3f(0.0),0.0,vec3f(0.0),0.0,false,false));
 let rank=flatIndex(id,groups,WORKGROUP_THREADS);
 if(rank>=sceneRays.count){return out;}
 let entry=sceneRays.entries[rank];
 out.at=vec2u(entry&0xffffu,entry>>16u);
 out.atlas=out.at/SP_TRACE;
 out.probe=spReadProbe(out.atlas);
 out.ok=out.probe.depth>0.0;
 return out;
}`,
  )

/**
 * ONE RAY MARCHED THROUGH THE GLOBAL DISTANCE FIELD (`spMarchRay`), from `start` (metres) along a direction over `[begin, reach]`, its
 * light read where it meets a surface: the march is the field's (`gdfTrace`: its step the distance read, its surface expanded by the
 * ray's time, and, where `dithered`, a ray stopped on a sample no mesh covers by noise, drawn at the ray's texel `coord` and the image's turn). The
 * light of a hit is the surface cache's final lighting (`scGlobalHit`, `../../surfaceCache/hitWgsl.ts`), the footprint of the ray's
 * cone at the hit — the cone the equal-area octahedron gives a texel of `side` texels a side (`scConeTangent`) — its radius. Lengths are metres for the
 * probes, centimetres for the field and the cache. `spMarch` is a probe's ray: it leaves a point the bias (`sp.scene.x`) off the probe's
 * surface along its normal (turned toward the ray on a probe with backface diffuse light) and again along itself, `begin` and `reach` are measured from there, and it is dithered.
 */
export const SP_MARCH = wgslBlock(
  'SP_MARCH',
  [surfaceHitWgsl(TRACE_SCENE_HIT), BOUNCE_CM_WGSL],
  `struct SpMarch{lighting:vec3f,hit:bool,distance:f32,}
fn spMarchRay(start:vec3f,d:vec3f,begin:f32,reach:f32,side:f32,dithered:bool,coord:vec2u)->SpMarch{
 var out=SpMarch(vec3f(0.0),false,0.0);
 if(begin>=reach||gdfView.clipmaps==0u){return out;}
 let origin=start*f32(BOUNCE_CM);
 let marched=gdfTraceRay(origin,d,begin*f32(BOUNCE_CM),reach*f32(BOUNCE_CM),1.0,true,dithered,coord,f32(sp.size.w%8u));
 if(marched.hitTime<0.0){return out;}
 out.hit=true;
 out.distance=marched.hitTime/f32(BOUNCE_CM);
 out.lighting=scGlobalHit(origin,d,marched,scConeTangent(side),true,-1.0,false,vec2u(0u)).radiance;
 return out;
}
fn spMarch(probe:SpProbe,d:vec3f,begin:f32,reach:f32,coord:vec2u,side:f32)->SpMarch{
 var normal=probe.N;
 if(probe.foliage&&dot(normal,d)<0.0){normal=-normal;}
 return spMarchRay(probe.P+(normal+d)*sp.scene.x,d,begin,reach,side,true,coord);
}`,
)

/**
 * THE SCENE STAGE'S ANSWER TO A PROBE'S RAY the screen did not answer: the march through the global distance field from where the screen
 * lost the ray (two biases back; the screen's end, `missed`) to the reach of the probe's cell (`spLocalReach`: as far as the
 * radiance cache is asked to be traced before it is read, the scene's limit where it covers none) — the surface cache's light at a hit,
 * the sky light that leaks onto it weighed at the distance of the hit from where the march began —, then, for a ray the march left (the cache's eight probes gathered for it alone, none for a ray that hit), the light the radiance cache holds along it and its distance as the
 * end (`spFarOf`: the environment's light and the furthest a ray looks where the cache covers none; a ray the cache's probes met no surface along keeps the furthest a ray looks too). The sky light that leaks onto what the ray found joins its light (`spSkyLeak`,
 * at the ray's end), and, where `fog`, the height fog (`spRayFogged`, `rayFogWgsl.ts`) is laid over the whole from the probe's own point over the end the ray reached — the
 * distance of the hit of a march, the cache's distance or the furthest a ray looks for a ray that hit nothing —, the light written once (`spRayLit`). A hit of the field's march is never moving (the field holds no velocity) and keeps in the ray's word, as its end, the reach it
 * was marched to, not the distance it hit at: a grazing hit's distance is noise the filters cannot remove.
 */
const sceneRay = (fog: boolean) =>
  wgslBlock(
    `SP_SCENE_RAY(${fog})`,
    fog ? [SP_MARCH, rayFogWgsl(TRACE_SCENE_FOG)] : [SP_MARCH],
    `struct SpScene{radiance:vec3f,word:u32,}
/** What the radiance cache answers along \`d\` from the probe: its eight probes gathered for the ray alone, then what lies past the near scene. */
fn spFarRay(probe:SpProbe,d:vec3f,side:f32)->SpFar{
 if(spFlag(SP_FLAG_CACHE)){spCacheGatherOwn(probe.P);}
 return spFarOf(probe.P,d,side);
}
/** The light of a ray of \`probe\` along \`d\` that reached \`end\` metres, whether it \`hit\` a surface: the \`radiance\` it found, the sky light that leaks onto it and, where the stage lays it, the height fog over the whole. */
fn spRayLit(radiance:vec3f,probe:SpProbe,d:vec3f,end:f32,hit:bool)->vec3f{
 let light=radiance+spSkyLeak(d,end);
${fog ? ' return spRayFogged(light,probe.P,d,end,hit);' : ' return light;'}
}
fn spSceneRay(probe:SpProbe,d:vec3f,missed:f32,coord:vec2u,side:f32)->SpScene{
 let reach=spLocalReach(probe.P);
 var march=SpMarch(vec3f(0.0),false,0.0);
 if(spFlag(SP_FLAG_SCENE_TRACES)){march=spMarch(probe,d,max(sp.motion.w,missed-2.0*sp.scene.x),reach,coord,side);}
 var radiance=march.lighting;
 var end=march.distance;
 var stored=reach;
 if(!march.hit){
  let far=spFarRay(probe,d,side);
  radiance+=far.radiance;
  end=far.distance;
  stored=far.stored;
 }
 return SpScene(spRayLit(radiance,probe,d,end,march.hit),spHitWord(stored,false));
}`,
  )

/** The scene stage, a thread a listed ray: its texel and where the screen left it read, its radiance and end written. `traceFar` is the
 *  radiance cache's answer to the rays the traced stage left (`SP_FAR_PENDING`): the rays whose word carries the mark, alone. */
const traceSceneStage = (fog: boolean) =>
  wgslBlock(
    `SP_TRACE_SCENE(${fog})`,
    [
      spListedRays(C.sceneRays),
      SP_RAY_CONE,
      sceneRay(fog),
      SP_FAR_PENDING,
      packLight,
      ditherLight,
      SP_TARGET_DITHER,
    ],
    `@group(0) @binding(${C.radiance}) var radianceOut:texture_storage_2d<${F.trace},write>;
@group(0) @binding(${C.hit}) var hitIo:texture_storage_2d<${F.hit},read_write>;
@group(0) @binding(${C.lights}) var<storage,read> directLights:DirectLights;
fn spTraceLight(light:vec3f,texel:vec2i)->u32{
 return packLight(ditherLight(light,spTargetDither(vec2u(texel),0)));
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn traceScene(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let ray=spListed(id,groups);
 if(!ray.ok){return;}
 let texel=vec2i(ray.at);
 let t=ray.at%SP_TRACE;
 let scene=spSceneRay(ray.probe,spRayDirection(ray.atlas,t,spIndexOf(ray.atlas)),spHitDistance(textureLoad(hitIo,texel).r),spRayNoiseTexel(spIndexOf(ray.atlas),t),spRayCone(ray.atlas,t));
 textureStore(radianceOut,texel,vec4u(spTraceLight(scene.radiance,texel),0u,0u,0u));
 textureStore(hitIo,texel,vec4u(scene.word,0u,0u,0u));
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn traceFar(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let ray=spListed(id,groups);
 if(!ray.ok){return;}
 let texel=vec2i(ray.at);
 if(textureLoad(hitIo,texel).r!=SP_FAR_PENDING){return;}
 let t=ray.at%SP_TRACE;
 let direction=spRayDirection(ray.atlas,t,spIndexOf(ray.atlas));
 let far=spFarRay(ray.probe,direction,spRayCone(ray.atlas,t));
 textureStore(radianceOut,texel,vec4u(spTraceLight(spRayLit(far.radiance,ray.probe,direction,far.distance,false),texel),0u,0u,0u));
 textureStore(hitIo,texel,vec4u(spHitWord(far.stored,false),0u,0u,0u));
}`,
  )

/** The scene stage's program over `side × side` rays a probe and `samples` of a tile, laying the height fog over the light of its rays where `fog`. */
export const traceSceneShader = (side: number, samples: readonly [number, number], fog: boolean) =>
  wgslProgram(
    `${spParams(C.params)}
${wgslConsts({ SP_TRACE: side })}`,
    [
      DIRECT_LIGHT_WGSL,
      bounceBindingsWgsl(0, C.bounceGrid, TRACE_SCENE_PROBES),
      spCommon(samples),
      spReach,
      spProbeRecords(C.info, C.normal, true),
      spCacheRead(C.cacheFinal, C.cacheRaw, C.cacheSky, 'private'),
      spRays(C.ray, C.pixels, C.blue, true),
      traceSceneStage(fog),
    ],
  )
