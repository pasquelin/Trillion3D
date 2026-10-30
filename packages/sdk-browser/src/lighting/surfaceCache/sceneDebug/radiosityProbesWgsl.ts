import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { TV_SH_WGSL } from '../../translucency/frameWgsl.ts'
import { VIEW_RAY_WGSL, VIEW_WGSL } from '../../deferred/worldAtWgsl.ts'
import { BOUNCE_CM_WGSL } from '../../bounce/tracedHitWgsl.ts'
import { lightingCommonWgsl, lightingLayersWgsl, surfaceTexelWgsl } from '../lighting/commonWgsl.ts'
import { radiosityCommonWgsl } from '../lighting/radiosityCommonWgsl.ts'
import { PROBE_CUBE_WGSL } from './radianceProbesWgsl.ts'
import { visualizeTonemapWgsl } from './visualizeTonemap.ts'

/**
 * THE SPHERES AT THE RADIOSITY'S PROBES over the image (`surfaceCacheRadiosityVisualizeProbes`): a thread a probe cell of every page lists the cells that hold a probe — the position of a probe
 * is the mean of the four texels round its cell's centre that hold a surface, and its place in the harmonics' atlas is marked invalid where the jittered texel the probe traces from holds none —
 * in a buffer whose arguments the draw reads; the draw then puts a cube round each probe and the fragment cuts the sphere out of it, coloured by the light the probe's harmonics give along the
 * normal of the sphere, or pink where the probe is invalid. The positions are relative to the eye, in metres.
 */

/** The bindings of the listing: the lighting parameters are at 0 (`createKernel`), then the cards' tables, the depth and normal layers, the arguments of the draw, the probes listed and the view. */
export const RADIOSITY_PROBES_LIST_BINDINGS = {
  tables: 1,
  depth: 2,
  normal: 3,
  args: 4,
  list: 5,
  view: 6,
} as const
const L = RADIOSITY_PROBES_LIST_BINDINGS

export const RADIOSITY_PROBES_LIST_ENTRY = 'debugRadiosityProbeList'

/** The bindings of the draw: its uniform, the probes listed, the harmonics (a layer a channel), the opaque depth, then the colour's seven from the view's uniform (`visualizeTonemapWgsl`). */
export const RADIOSITY_PROBES_DRAW_BINDINGS = {
  draw: 0,
  list: 1,
  harmonics: 2,
  depth: 3,
  tone: 4,
} as const
const D = RADIOSITY_PROBES_DRAW_BINDINGS

/** Words of the draw's uniform: the view-projection, then the radius, whether the invalid probes are drawn, the inverse of the cached lighting's exposure and a pad, then the display's size. */
export const RADIOSITY_PROBES_DRAW_WORDS = 24

/** A probe the listing found no surface for: the word of its place in the atlas. */
const NO_PROBE = '0xffffffffu'

/** The listing's program. */
export const radiosityProbesListWgsl = wgslProgram(
  `@group(0) @binding(${L.args}) var<storage,read_write> drawArgs:array<atomic<u32>>;
@group(0) @binding(${L.list}) var<storage,read_write> probeList:array<vec4u>;
@group(0) @binding(${L.view}) var<uniform> view:View;
@compute @workgroup_size(${WORKGROUP_THREADS}) fn ${RADIOSITY_PROBES_LIST_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let perPage=PHYSICAL_PAGE/lp.spacing;
 let thread=id.x+id.y*groups.x*${WORKGROUP_THREADS}u;
 let page=thread/(perPage*perPage);
 if(!pageHasProbes(page)){return;}
 let cell=thread-page*perPage*perPage;
 let inCard=vec2u(cell%perPage,cell/perPage)*lp.spacing;
 let lower=inCard+vec2u((lp.spacing-1u)/2u);
 let t00=radTexel(page,lower);
 let t01=radTexel(page,lower+vec2u(0u,1u));
 let t10=radTexel(page,lower+vec2u(1u,0u));
 let t11=radTexel(page,lower+vec2u(1u,1u));
 // The probe is valid where the texel it traces from, jittered inside its cell, holds a surface.
 let own=radTexel(page,inCard+pageJitter(page));
 let count=u32(t00.valid)+u32(t01.valid)+u32(t10.valid)+u32(t11.valid);
 if(count==0u){return;}
 let weight=1.0/f32(count);
 var position=vec3f(0.0);
 if(t00.valid){position+=t00.position*weight;}
 if(t01.valid){position+=t01.position*weight;}
 if(t10.valid){position+=t10.position*weight;}
 if(t11.valid){position+=t11.position*weight;}
 let at=atomicAdd(&drawArgs[1],1u);
 if(at>=arrayLength(&probeList)){return;}
 let atlas=probeAtlasCoord(pageMin(page)+inCard);
 var packed=atlas.x|(atlas.y<<16u);
 if(!(own.inside&&own.valid)){packed=${NO_PROBE};}
 let relative=position/f32(BOUNCE_CM)-viewEye();
 probeList[at]=vec4u(bitcast<u32>(relative.x),bitcast<u32>(relative.y),bitcast<u32>(relative.z),packed);
}`,
  [
    lightingCommonWgsl({ tables: L.tables }),
    surfaceTexelWgsl(lightingLayersWgsl(L.depth, L.normal)),
    radiosityCommonWgsl(),
    VIEW_WGSL,
    VIEW_RAY_WGSL,
    BOUNCE_CM_WGSL,
  ],
)

/** The draw's program: a cube round each probe listed, the sphere cut out in the fragment and coloured by the harmonics. */
export const radiosityProbesDrawWgsl = wgslProgram(
  `struct ProbeDraw{viewProj:mat4x4f,radius:f32,showInvalid:u32,invPreExposure:f32,pad:f32,display:vec4f}
@group(0) @binding(${D.draw}) var<uniform> probeDraw:ProbeDraw;
@group(0) @binding(${D.list}) var<storage,read> probeList:array<vec4u>;
@group(0) @binding(${D.harmonics}) var probeHarmonics:texture_2d_array<f32>;
@group(0) @binding(${D.depth}) var sceneDepth:texture_depth_2d;
struct Out{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) sphere:vec4f,
 @location(1) @interpolate(flat) atlas:vec2u,
 @location(2) @interpolate(flat) valid:u32,
 @location(3) world:vec3f,
}
@vertex fn radiosityProbeVs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{
 var out:Out;
 out.position=vec4f(2.0,2.0,2.0,1.0);
 if(instance>=arrayLength(&probeList)){return out;}
 let record=probeList[instance];
 let valid=record.w!=${NO_PROBE};
 if(!(valid||probeDraw.showInvalid!=0u)){return out;}
 let centre=vec3f(bitcast<f32>(record.x),bitcast<f32>(record.y),bitcast<f32>(record.z));
 out.world=centre+probeCubeCorner(vertex)*probeDraw.radius;
 out.position=probeDraw.viewProj*vec4f(out.world,1.0);
 out.sphere=vec4f(centre,probeDraw.radius);
 out.atlas=vec2u(record.w&0xffffu,record.w>>16u);
 out.valid=u32(valid);
 return out;
}
struct Shaded{@location(0) colour:vec4f,@builtin(frag_depth) depth:f32}
@fragment fn radiosityProbeFs(in:Out)->Shaded{
 // The near root of the ray through the cube's point against the sphere, the ray the cube was projected by (not the jittered one); none, or behind the eye, cuts the pixel out. The positions are relative to the eye.
 let fromEye=view.camera.w!=0.0;
 let direction=select(-normalize(view.camera.xyz),normalize(in.world),fromEye);
 let start=select(in.world-direction*2.0*in.sphere.w,vec3f(0.0),fromEye);
 let toStart=start-in.sphere.xyz;
 let b=dot(toStart,direction);
 let reach=b*b-(dot(toStart,toStart)-in.sphere.w*in.sphere.w);
 if(reach<0.0){discard;}
 let t=-b-sqrt(reach);
 if(t<0.0){discard;}
 let hit=start+direction*t;
 let projected=probeDraw.viewProj*vec4f(hit,1.0);
 let depth=projected.z/projected.w;
 // The spheres are drawn against the opaque depth, which the display may not match in size.
 let dims=textureDimensions(sceneDepth);
 let covered=min(vec2u(in.position.xy*vec2f(dims)/probeDraw.display.xy),dims-vec2u(1u));
 if(depth<textureLoad(sceneDepth,vec2i(covered),0)){discard;}
 // A probe on no surface is pink.
 var shown=vec3f(1.0,0.0,1.0);
 if(in.valid!=0u){
  let normal=normalize(hit-in.sphere.xyz);
  let transfer=tvBasis(normal)*vec4f(TV_L0,TV_L1,TV_L1,TV_L1);
  let at=vec2i(in.atlas);
  let irradiance=max(vec3f(dot(textureLoad(probeHarmonics,at,0,0),transfer),dot(textureLoad(probeHarmonics,at,1,0),transfer),dot(textureLoad(probeHarmonics,at,2,0),transfer)),vec3f(0.0));
  shown=saturate(visualizeTonemap(irradiance/PI*probeDraw.invPreExposure*view.preExposure.x,true));
 }
 return Shaded(vec4f(shown,1.0),depth);
}`,
  [PI, TV_SH_WGSL, PROBE_CUBE_WGSL, visualizeTonemapWgsl(D.tone)],
)
