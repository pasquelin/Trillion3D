import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { skyLightReadWgsl, type SkyLightBindings } from '../../../modules/sky/skyLight/read.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { surfaceHitWgsl } from '../hitWgsl.ts'
import { lightingCommonWgsl, READ_LIBRARY_LAYERS_WGSL, surfaceTexelWgsl } from './commonWgsl.ts'
import { radiosityCommonWgsl } from './radiosityCommonWgsl.ts'

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
 * Lengths are centimetres. Bindings: 0 the parameters, 1 the tables with the atlas's layers from 2 (the albedo, the emission
 * and the direct and indirect light, 3, 5, 6 and 7, unread), 9 the context, 10 the probes' trace atlas, 11 the lights, 12 to 15 the sky light, 16 to 21
 * the global field and 22 its object grid, 23 the table of instances, 24 the blue noise.
 */

export const RADIOSITY_TRACE_BINDINGS = {
  tables: 1,
  depth: 2,
  albedo: 3,
  normal: 4,
  emissive: 5,
  direct: 6,
  indirect: 7,
  final: 8,
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
export const RADIOSITY_TRACE_UNREAD: readonly number[] = [
  RADIOSITY_TRACE_BINDINGS.albedo,
  RADIOSITY_TRACE_BINDINGS.emissive,
  RADIOSITY_TRACE_BINDINGS.direct,
  RADIOSITY_TRACE_BINDINGS.indirect,
]

export const RADIOSITY_TRACE_ENTRY = 'radiosityTrace'

const B = RADIOSITY_TRACE_BINDINGS

export const RADIOSITY_TRACE_WGSL = wgslProgram(
  `@group(0) @binding(${B.out}) var outTrace:texture_storage_2d<r32uint,write>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@compute @workgroup_size(${WORKGROUP_THREADS})
fn ${RADIOSITY_TRACE_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let thread=radRayThread(id.x+id.y*n.x*${WORKGROUP_THREADS}u);
 if(!thread.ok){return;}
 let at=thread.at;
 let texel=thread.texel;
 var radiance=vec3f(0.0);
 if(texel.valid){
  let dir=radiosityRay(texel.normal,texel.temporal,texel.cardCoord>>vec2u(lp.spacingShift),at.ray);
  let start=texel.position+texel.normal*lp.surfaceBias+dir*lp.surfaceBias;
  let hit=gdfTraceRay(start,dir,lp.minTrace,lp.maxTrace,1.0,true,false,vec2u(0u),0.0);
  if(hit.hitTime>=0.0){radiance=scGlobalHit(start,dir,hit,scConeTangent(f32(lp.hemisphere)),true,-1.0,false,vec2u(0u)).radiance;}else{radiance=skyProbeRadiance(dir);}
  let brightest=max(radiance.x,max(radiance.y,radiance.z));
  if(brightest>lp.maxRayIntensity){radiance*=lp.maxRayIntensity/brightest;}
 }
 let place=probeAtlasCoord(texel.atlas)*lp.hemisphere+at.ray;
 textureStore(outTrace,vec2i(place),vec4u(packLight(radiance*lp.preExposure),0u,0u,0u));
}`,
  [
    lightingCommonWgsl({ tables: B.tables, context: { binding: B.context, access: 'read' } }),
    READ_LIBRARY_LAYERS_WGSL,
    surfaceTexelWgsl(READ_LIBRARY_LAYERS_WGSL),
    radiosityCommonWgsl(B.noise),
    DIRECT_LIGHT_WGSL,
    skyLightReadWgsl(B.sky),
    SKY_READ_WGSL,
    surfaceHitWgsl({
      group: 0,
      field: B.field,
      grid: B.grid,
      cards: B.tables,
      instances: B.instances,
    }),
    packLight,
  ],
)
