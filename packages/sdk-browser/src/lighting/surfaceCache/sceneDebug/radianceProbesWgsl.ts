import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { equalAreaEncode } from '../../../../../math/src/wgsl/octahedral.ts'
import { bilinear3 } from '../../../../../math/src/wgsl/sampling.ts'
import {
  lightAtlasScalar,
  lightReadDeps,
  type LightAtlasFormat,
} from '../../../gpu/core/lightAtlasFormat.ts'
import { CACHE_WORDS_WGSL } from '../../bounce/cache/cacheWordsWgsl.ts'
import { bounceBindingsWgsl } from '../../bounce/gridWgsl.ts'
import {
  FIELD_IRRADIANCE_READ,
  FIELD_SLOT_CONSTS,
  FIELD_SLOT_SHIFT_WGSL,
  fieldMapReads,
} from '../../bounce/irradianceField/gatherWgsl.ts'
import { FIELD_MAP_BORDER } from '../../bounce/irradianceField/mapsWgsl.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { skyLightReadWgsl } from '../../../modules/sky/skyLight/read.ts'
import { visualizeTonemapWgsl } from './visualizeTonemap.ts'

/**
 * THE SPHERES AT THE WORLD'S PROBES over the image (`radianceCacheVisualize`): for each level, a kernel lists the cells that hold a probe, and the adaptive probes a cell took, in a
 * buffer with the arguments of the draw (the first clears the count, the second appends); the draw then puts a cube round each probe and the fragment cuts the sphere out of it,
 * coloured by the light the probe holds along the normal of the sphere.
 */

/** The bindings of the three programs: the levels' uniform and the cell table, the view of the draw, the maps' parameters, the adaptive probes of each cell, the pool's slots, the probes listed and the arguments of the draw (the compute stage writes them; the draw reads the list alone), then the draw's maps. */
export const RADIANCE_PROBE_BINDINGS = {
  grid: 0,
  table: 1,
  view: 2,
  maps: 3,
  adaptive: 4,
  slots: 5,
  list: 6,
  args: 7,
  final: 8,
  irradiance: 9,
  valid: 10,
  sky: 11,
  depth: 12,
  /** The colour's seven bindings, from the view's uniform to the table's reading (`visualizeTonemapWgsl`). */
  tone: 13,
} as const
const B = RADIANCE_PROBE_BINDINGS

/** Where the draw reads the sky light, after the colour's four bindings: the radiance cache's sky share resolved to the sky along the normal (`skyProbeRadiance`). */
export const RADIANCE_PROBE_SKY_LIGHT = {
  group: 0,
  cube: B.tone + 4,
  sampler: B.tone + 5,
  harmonics: B.tone + 6,
  params: B.tone + 7,
} as const

/** Words of the view's uniform: the view-projection, then the level, what it shows, its flags and the adaptive probes a cell may hold, then the size of the sphere over the cell and the display's size. */
export const RADIANCE_PROBE_VIEW_WORDS = 24
/** The flags of a view: the maps are the irradiance field's, the sky's share is kept. */
export const RADIANCE_PROBE_FLAG = { irradiance: 1, sky: 2 } as const
/** The vertices of a cube drawn, and the corners (bit 0 along x, bit 1 along y, bit 2 along z) of its twelve triangles. */
export const RADIANCE_PROBE_VERTICES = 36
const CUBE = [
  0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 1, 3, 0, 3, 2, 4, 6, 7,
  4, 7, 5,
]

/** The share of the rays of a probe that left the scene along a direction, over the sky atlas `skyAtlas` and the maps' parameters `field` the program declares. */
export const RADIANCE_PROBE_SKY_SHARE = `// The share of the rays of the probe in 'slot' that left the scene along 'direction': the sky's map, bilinear, over the border of the final maps.
fn visSky(slot:u32,direction:vec3f)->f32{
 let res=u32(field[1].z);
 let border=1u<<(u32(field[1].w)-1u);
 let tile=cacheTileOf(slot,res+2u*border);
 let q=equalAreaEncode(direction)*f32(res)+vec2f(f32(border)-0.5);
 let base=vec2i(tile)+vec2i(floor(q));
 let f=q-floor(q);
 let a=textureLoad(skyAtlas,base,0).r;
 let b=textureLoad(skyAtlas,base+vec2i(1,0),0).r;
 let c=textureLoad(skyAtlas,base+vec2i(0,1),0).r;
 let d=textureLoad(skyAtlas,base+vec2i(1,1),0).r;
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}`

const declarations = (list: 'read' | 'write') => `${FIELD_SLOT_CONSTS}
struct Vis{viewProj:mat4x4f,pick:vec4u,scale:vec4f}
@group(0) @binding(${B.view}) var<uniform> vis:Vis;
@group(0) @binding(${B.adaptive}) var<storage,read> adaptiveProbes:array<u32>;
@group(0) @binding(${B.slots}) var<storage,read> poolSlots:array<u32>;
@group(0) @binding(${B.list}) var<storage,${list === 'read' ? 'read' : 'read_write'}> probeList:array<vec4u>;
${FIELD_SLOT_SHIFT_WGSL}
// The slot plus one that holds the probe of rank 'rank' (0 the cell's own, then its adaptive ones) in 'cell' of 'level', zero for none. pick: the level, what is shown, the flags, the adaptive probes a cell may hold.
fn visHeld(level:u32,cell:vec3i,rank:u32)->u32{
 if(rank==0u){return cacheSlotOf(level,cell);}
 if(rank>vis.pick.w){return 0u;}
 return adaptiveProbes[cellEntry(level,probeWrap(cell))*FIELD_MAX_ADAPTIVE+rank-1u]>>16u;
}`

/** The kernels that list the probes of a level: one thread to clear the arguments, a thread a cell to append. */
export const radianceProbeListWgsl = wgslProgram(
  `${declarations('write')}
@group(0) @binding(${B.args}) var<storage,read_write> drawArgs:array<atomic<u32>>;
@compute @workgroup_size(1) fn debugRadianceProbeClear(){
 atomicStore(&drawArgs[0],${RADIANCE_PROBE_VERTICES}u);
 atomicStore(&drawArgs[1],0u);
 atomicStore(&drawArgs[2],0u);
 atomicStore(&drawArgs[3],0u);
}
// A thread a cell of the level, in a line of the cells (x along the fastest).
@compute @workgroup_size(64) fn debugRadianceProbeBuild(@builtin(global_invocation_id) id:vec3u){
 let side=bounce.counts.x;
 if(id.x>=side*side*side){return;}
 let local=vec3u(id.x%side,(id.x/side)%side,id.x/(side*side));
 let level=vis.pick.x;
 let cell=vec3i(bounce.levels[level].base)+vec3i(local);
 for(var rank=0u;rank<=vis.pick.w;rank++){
  if(visHeld(level,cell,rank)==0u){continue;}
  let at=atomicAdd(&drawArgs[1],1u);
  if(at<arrayLength(&probeList)){probeList[at]=vec4u(bitcast<u32>(cell.x),bitcast<u32>(cell.y),bitcast<u32>(cell.z),rank);}
 }
}`,
  [CACHE_WORDS_WGSL, bounceBindingsWgsl(0, B.grid, B.table)],
)

/** The draw: a cube round each probe, the sphere cut out in the fragment and coloured by the light. */
export const radianceProbeDrawWgsl = (light: LightAtlasFormat) =>
  wgslProgram(
    `${wgslConsts({ FIELD_MAP_BORDER })}
${declarations('read')}
@group(0) @binding(${B.maps}) var<uniform> field:array<vec4f,3>;
@group(0) @binding(${B.final}) var finalAtlas:texture_2d<${lightAtlasScalar(light)}>;
@group(0) @binding(${B.irradiance}) var irradianceAtlas:texture_2d<f32>;
@group(0) @binding(${B.valid}) var<storage,read> probeValid:array<u32>;
@group(0) @binding(${B.sky}) var skyAtlas:texture_2d<f32>;
@group(0) @binding(${B.depth}) var sceneDepth:texture_depth_2d;
${fieldMapReads(light)}
${FIELD_IRRADIANCE_READ}
${RADIANCE_PROBE_SKY_SHARE}
var<private> CUBE=array<u32,${RADIANCE_PROBE_VERTICES}>(${CUBE.map((corner) => `${corner}u`).join(',')});
struct Out{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) cell:vec3i,
 @location(1) @interpolate(flat) rank:u32,
 @location(2) @interpolate(flat) sphere:vec4f,
 @location(3) world:vec3f,
}
@vertex fn radianceProbeVs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{
 var out:Out;
 out.position=vec4f(2.0,2.0,2.0,1.0);
 let level=vis.pick.x;
 let record=probeList[instance];
 let cell=vec3i(bitcast<i32>(record.x),bitcast<i32>(record.y),bitcast<i32>(record.z));
 let held=visHeld(level,cell,record.w);
 // A probe the cell no longer holds is not drawn.
 if(held==0u){return out;}
 let spacing=bounce.levels[level].spacing;
 let radius=vis.scale.x*spacing;
 let corner=CUBE[vertex];
 let local=vec3f(select(-1.0,1.0,(corner&1u)!=0u),select(-1.0,1.0,(corner&2u)!=0u),select(-1.0,1.0,(corner&4u)!=0u))*radius;
 let centre=probePosition(cell,spacing)+fieldSlotShift(held);
 out.world=centre+local;
 out.position=vis.viewProj*vec4f(out.world,1.0);
 out.cell=cell;
 out.rank=record.w;
 out.sphere=vec4f(centre,radius);
 return out;
}
@fragment fn radianceProbeFs(in:Out)->@location(0) vec4f{
 // The cube is drawn against the opaque depth, which the display may not match in size.
 let dims=textureDimensions(sceneDepth);
 let at=min(vec2u(in.position.xy*vec2f(dims)/vis.scale.yz),dims-vec2u(1u));
 if(in.position.z<textureLoad(sceneDepth,vec2i(at),0)){discard;}
 // The near root of the ray from the eye through the cube's pixel against the sphere; none, or behind the eye, cuts the pixel out.
 let direction=in.world-bounce.eye.xyz;
 let toEye=bounce.eye.xyz-in.sphere.xyz;
 let a=dot(direction,direction);
 let b=dot(direction,toEye);
 let reach=b*b-a*(dot(toEye,toEye)-in.sphere.w*in.sphere.w);
 if(reach<0.0){discard;}
 let t=(-b-sqrt(reach))/a;
 if(t<0.0){discard;}
 let normal=normalize(toEye+direction*t);
 let held=visHeld(vis.pick.x,in.cell,in.rank);
 var lighting=vec3f(0.0,1000.0,0.0);
 if(held!=0u){
  let slot=held-1u;
  lighting=vec3f(0.0);
  if(vis.pick.y==2u){
   if((vis.pick.z&${RADIANCE_PROBE_FLAG.sky}u)!=0u){lighting=vec3f(visSky(slot,normal));}
  }else if((vis.pick.z&${RADIANCE_PROBE_FLAG.irradiance}u)!=0u){
   // The irradiance at an albedo of 0.3; a probe moved off the surfaces is tinted green, one inside a surface red, an adaptive one cyan.
   lighting=fieldIrradiance(slot,normal)*0.3;
   let shift=fieldSlotShift(held);
   if(dot(shift,shift)>0.0){lighting.g+=0.1;}
   if(probeValid[slot]==0u){lighting=vec3f(1.0,0.0,0.0);}
   if(in.rank>0u){lighting=vec3f(0.0,1.0,1.0);}
  }else{
   // The share of the probe's rays that left the scene is filled in with the sky along the normal.
   lighting=fieldRadiance(slot,normal,0.0);
   if((vis.pick.z&${RADIANCE_PROBE_FLAG.sky}u)!=0u){
    let leaving=visSky(slot,normal);
    if(leaving>0.0&&skyLit()){lighting=mix(lighting,skyProbeRadiance(normal),leaving);}
   }
  }
 }
 return vec4f(saturate(visualizeTonemap(lighting,true)),1.0);
}`,
    [
      CACHE_WORDS_WGSL,
      bounceBindingsWgsl(0, B.grid, B.table),
      equalAreaEncode,
      bilinear3,
      ...lightReadDeps(light),
      visualizeTonemapWgsl(B.tone),
      skyLightReadWgsl(RADIANCE_PROBE_SKY_LIGHT),
      SKY_READ_WGSL,
    ],
  )
