import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import {
  lightStoreDeps,
  lightTexelPlain,
  type LightAtlasFormat,
} from '../../../gpu/core/lightAtlasFormat.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { skyLightReadWgsl, type SkyLightBindings } from '../../../modules/sky/skyLight/read.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { sceneTraceAvoidWgsl } from '../../rays/sceneTrace/avoidWgsl.ts'
import { surfaceHitCardsWgsl, surfaceHitWgsl } from '../hitWgsl.ts'
import { SURFACE_CACHE_LAYER_AT as L } from '../sampleWgsl.ts'
import {
  CM_PER_M_WGSL,
  lightingCommonWgsl,
  READ_LIBRARY_LAYERS_WGSL,
  surfaceTexelWgsl,
} from './commonWgsl.ts'
import { radiosityCommonWgsl, radiosityRayWgsl } from './radiosityCommonWgsl.ts'

/**
 * THE RADIOSITY'S RAYS: a thread a ray of the radiosity tiles' probes (`radiosityBuildWgsl.ts`), which holds the radiance
 * its probe's texel sees along it, written to the probes' trace atlas multiplied by the pre-exposure — the atlas holds, for
 * each probe, a square of `hemisphere` × `hemisphere` words of light, at the probe's place in the probes' atlas.
 *
 * The ray starts off its texel by `surfaceBias` along the normal and again along itself, and is marched through the global
 * distance field from `minTrace` to `maxTrace` (`gdfTrace`, expanded by the time of the ray). Where it meets a surface the
 * radiance is what the surface cache holds there (`scGlobalHit`, `../hitWgsl.ts`: the final light, fading in over the hit's first
 * voxels so that a ray never reads its own surface), over the tangent of the cone of a ray (`hemisphere²` rays share the hemisphere); where it meets none it reads the sky (`skyProbeRadiance`). No ray brings more
 * than `maxRayIntensity`, the largest channel, scaled down to it.
 *
 * Lengths are centimetres. Bindings: 0 the parameters, 1 the tables with the atlas's layers after them (`cardBindings`: the
 * albedo, the emission and the direct and indirect light unread), 9 the context, 10 the probes' trace atlas, 11 the lights, 12 to 15 the sky light, 16 to 21
 * the global field and 22 its object grid, 23 the table of instances, 24 the blue noise.
 *
 * THE TRACED VARIANT (`RADIOSITY_TRACED_WGSL`), where the scene has acceleration structures and
 * `surfaceCacheRadiosityHardwareRayTracing` is on: the same threads, the same write, the ray cast through the scene's triangles
 * (`../../rays/sceneTrace/sceneTraceWgsl.ts`, in group 1) instead of marched through the field. It starts off its texel by
 * `radiosityNormalBias` along the normal (nothing along itself), from `radiosityRayBias` along the ray to `maxTrace`, ignoring
 * the translucent primitives, and avoids the geometry it starts on as `selfIntersections` says (`SELF_INTERSECTION`): the back
 * faces of the primitives that are not two-sided culled; or, traced again from past a first hit that is a back face nearer than
 * the trace's `skipBackFaceDistance` or a two-sided hit nearer than its `skipTwoSidedDistance`; or such hits passed as it
 * travels. A trace that stopped before its walk was whole and met nothing is a black hit; one that met a surface is a hit too
 * (its distance is kept) but brings no light, the cards being read only where the walk was whole. A hit reads the cards of the placement
 * it met (`scHitPlacement`, by the object the hit names: the rank of its root — the table of instances names every root of a placement's mesh — or the stand-in of its HLOD cell's actor) at its
 * point, with the hit's normal facing the ray, the cone's footprint at its distance and `cardDepthBias` for the depth of a
 * texel from it; it brings nothing from nearer than `cardMinDistance`, nor from the back face of a primitive that is not
 * two-sided; a ray that hits nothing reads the sky. Its bindings (group 0) clear the cut's tables, which keep the culling's:
 * the cards' tables from 10 with the atlas's layers after them, 18 the context, 19 the probes' trace
 * atlas, 20 the lights, 21 to 24 the sky light, 25 the table of instances, 26 the blue noise, 27 the distances the rays met their surfaces at.
 * Where the probes' occlusion is on (`FLAG_PROBE_OCCLUSION`) it writes, beside each ray's radiance, that distance: from its texel to the point
 * of the triangle the ray hit, the longest trace where it hit nothing (the probes' occlusion reads it in the filter and the integration,
 * `probeVisibility`).
 */

/** The cards' tables at `tables` and the atlas's layers after them, as the read library binds them (`SURFACE_CACHE_LAYER_AT`). */
const cardBindings = (tables: number) => ({
  tables,
  depth: tables + L.depth,
  albedo: tables + L.albedo,
  normal: tables + L.normal,
  emissive: tables + L.emissive,
  direct: tables + L.direct,
  indirect: tables + L.indirect,
  final: tables + L.final,
})

/** The bindings of the layers the trace never reads, which its layout leaves out. */
const unreadLayers = (cards: ReturnType<typeof cardBindings>): readonly number[] => [
  cards.albedo,
  cards.emissive,
  cards.direct,
  cards.indirect,
]

export const RADIOSITY_TRACE_BINDINGS = {
  ...cardBindings(1),
  context: 9,
  out: 10,
  lights: 11,
  sky: { group: 0, cube: 12, sampler: 13, harmonics: 14, params: 15 } satisfies SkyLightBindings,
  field: 16,
  grid: 22,
  instances: 23,
  noise: 24,
} as const

/** The bindings of the atlas layers the trace never reads, which its layout leaves out. */
export const RADIOSITY_TRACE_UNREAD = unreadLayers(RADIOSITY_TRACE_BINDINGS)

/** The traced variant's bindings: the cut's tables are the culling's (`DAG_BINDING`: 1, 6, 7 and 9 of group 0), so its own
 *  begin at 10; the field and its grid are not bound. */
export const RADIOSITY_TRACED_BINDINGS = {
  ...cardBindings(10),
  context: 18,
  out: 19,
  lights: 20,
  sky: { group: 0, cube: 21, sampler: 22, harmonics: 23, params: 24 } satisfies SkyLightBindings,
  instances: 25,
  noise: 26,
  hits: 27,
} as const

/** The bindings of the layers the traced variant never reads. */
export const RADIOSITY_TRACED_UNREAD = unreadLayers(RADIOSITY_TRACED_BINDINGS)

/** The scene trace's group and its first binding in it. */
export const RADIOSITY_TRACED_SCENE = { group: 1, first: 0 } as const

export const RADIOSITY_TRACE_ENTRY = 'radiosityTrace'

const B = RADIOSITY_TRACE_BINDINGS
const TB = RADIOSITY_TRACED_BINDINGS

/** The declarations the kernel of either variant writes to, in the format `light`, and reads the lights from, at `b`'s bindings. */
const kernelBindings = (b: { out: number; lights: number }, light: LightAtlasFormat) =>
  `@group(0) @binding(${b.out}) var outTrace:texture_storage_2d<${light},write>;
@group(0) @binding(${b.lights}) var<storage,read> directLights:DirectLights;`

/** The kernel both variants share: a thread a ray, `bindings` the variant's declarations and `rayRadiance` its function
 *  `rayRadiance(texel:RadTexel,dir:vec3f)->vec3f`, the radiance the texel sees along `dir`. `hitDistances`, the traced variant's, is the
 *  distance the ray met its surface at, which `rayRadiance` leaves in `rayHitDistance`: the kernel starts it at the longest trace and
 *  stores it beside the radiance where the probes' occlusion is on. */
const radiosityKernel = (
  bindings: string,
  rayRadiance: string,
  light: LightAtlasFormat,
  hitDistances = false,
) => `${bindings}
${rayRadiance}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn ${RADIOSITY_TRACE_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let thread=radRayThread(id.x+id.y*n.x*${WORKGROUP_THREADS}u);
 if(!thread.ok){return;}
 let at=thread.at;
 let texel=thread.texel;
 var radiance=vec3f(0.0);
${hitDistances ? ' rayHitDistance=lp.maxTrace;\n' : ''} if(texel.valid){
  let dir=radiosityRay(texel.normal,texel.temporal,texel.cardCoord>>vec2u(lp.spacingShift),at.ray);
  radiance=rayRadiance(texel,dir);
  let brightest=max(radiance.x,max(radiance.y,radiance.z));
  if(brightest>lp.maxRayIntensity){radiance*=lp.maxRayIntensity/brightest;}
 }
 let place=probeAtlasCoord(texel.atlas)*lp.hemisphere+at.ray;
 textureStore(outTrace,vec2i(place),${lightTexelPlain(light, 'radiance*lp.preExposure')});
${hitDistances ? ' if(lgFlag(FLAG_PROBE_OCCLUSION)){textureStore(outHits,vec2i(place),vec4f(rayHitDistance,0.0,0.0,0.0));}\n' : ''}}`

/** What both variants read: the lighting's common text, the cards' layers, the radiosity's, the lights and the sky. */
const sharedDeclarations = (b: typeof B | typeof TB, light: LightAtlasFormat): WgslDecl[] => [
  lightingCommonWgsl({ tables: b.tables, context: { binding: b.context, access: 'read' } }),
  READ_LIBRARY_LAYERS_WGSL,
  surfaceTexelWgsl(READ_LIBRARY_LAYERS_WGSL),
  radiosityCommonWgsl(),
  radiosityRayWgsl(b.noise),
  DIRECT_LIGHT_WGSL,
  skyLightReadWgsl(b.sky),
  SKY_READ_WGSL,
  packLight,
  ...lightStoreDeps(light),
]

/** The trace through the global field, the rays' radiance stored in `light`, and the cache's final light read in it. */
export const radiosityTraceProgramOf = (light: LightAtlasFormat) =>
  wgslProgram(
    radiosityKernel(
      kernelBindings(B, light),
      `fn rayRadiance(texel:RadTexel,dir:vec3f)->vec3f{
 let start=texel.position+texel.normal*lp.surfaceBias+dir*lp.surfaceBias;
 let hit=gdfTraceRay(start,dir,lp.minTrace,lp.maxTrace,1.0,true,false,vec2u(0u),0.0);
 if(hit.hitTime>=0.0){return scGlobalHit(start,dir,hit,scConeTangent(f32(lp.hemisphere)),true,-1.0,false,vec2u(0u)).radiance;}
 return skyProbeRadiance(dir);
}`,
      light,
    ),
    [
      ...sharedDeclarations(B, light),
      surfaceHitWgsl(
        {
          group: 0,
          field: B.field,
          grid: B.grid,
          cards: B.tables,
          instances: B.instances,
        },
        light,
      ),
    ],
  )

/** The radiance the texel sees along `dir`, through the scene's triangles. */
const TRACED_RADIANCE = `
@group(0) @binding(${TB.hits}) var outHits:texture_storage_2d<r32float,write>;
var<private> rayHitDistance:f32;
fn rayRadiance(texel:RadTexel,dir:vec3f)->vec3f{
 let start=texel.position+texel.normal*lp.radiosityNormalBias;
 let origin=(start-lp.camera.xyz)/CM_PER_M;
 let reach=lp.maxTrace/CM_PER_M;
 let hit=stTraceAvoiding(origin,dir,lp.radiosityRayBias/CM_PER_M,reach,lp.selfIntersections);
 // A trace that stopped before its walk was whole and met nothing is a black hit; one that met a surface is a hit with no light.
 if(!hit.hit){return select(skyProbeRadiance(dir),vec3f(0.0),!stComplete);}
 let hitCm=hit.distance*CM_PER_M;
 rayHitDistance=length(texel.position-(start+dir*hitCm));
 // A hit of a trace that stopped before its walk was whole may not be the nearest: it is a hit with no light.
 if(!stComplete){return vec3f(0.0);}
 // A hit too near to tell from the texel itself would light it with its own light; the back of a one-sided surface has no cards.
 if(hitCm<lp.cardMinDistance||(!hit.frontFace&&!hit.twoSided)){return vec3f(0.0);}
 let cards=scPlacementMeshCards(scHitPlacement(hit.object));
 return scEvaluateMeshCards(cards,start+dir*hitCm,hit.normal,scConeTangent(f32(lp.hemisphere))*hitCm,lp.cardDepthBias,false,vec2u(0u)).radiance;
}`

/** The trace through the scene's triangles, the rays' radiance stored in `light`, and the cache's final light read in it. */
export const radiosityTracedProgramOf = (light: LightAtlasFormat) =>
  wgslProgram(radiosityKernel(kernelBindings(TB, light), TRACED_RADIANCE, light, true), [
    ...sharedDeclarations(TB, light),
    CM_PER_M_WGSL,
    surfaceHitCardsWgsl({ group: 0, cards: TB.tables, instances: TB.instances }, light),
    sceneTraceAvoidWgsl(RADIOSITY_TRACED_SCENE.group, RADIOSITY_TRACED_SCENE.first),
  ])
