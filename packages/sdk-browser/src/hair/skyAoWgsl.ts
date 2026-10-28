import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { frameAround, outOfFrame } from '../../../math/src/wgsl/basis.ts'
import {
  hammersley16,
  rand3dPcg16,
  sampleCosineHemisphere,
} from '../../../math/src/wgsl/sampling.ts'
import { FULLSCREEN_VERTEX } from '../gpu/shader/fullscreenTriangle.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from '../lighting/deferred/worldAtWgsl.ts'
import { VOXEL_PARAMS_WGSL } from './voxelWgsl.ts'
import { voxelTraversalWgsl } from './voxelTraversalWgsl.ts'

/** The bindings of the occlusion pass (group 0): the volume's (parameters, nodes, page index, voxels), its own parameters, the occlusion drawn so far, the
 *  depth, the normals and the lighting's view. */
export const HAIR_SKY_AO_BINDINGS = {
  nodes: 1,
  pageIndex: 2,
  voxels: 3,
  params: 4,
  source: 5,
  depth: 6,
  normals: 7,
  view: 8,
} as const
/** The words of the pass's parameters block (`HairSkyAoParams`). */
export const HAIR_SKY_AO_PARAM_WORDS = 12
/** The farthest an occlusion ray goes before it is cut by the distance threshold: the reference's 1000 centimetres, in metres. */
const AO_MAX_DISTANCE = 10

const B = HAIR_SKY_AO_BINDINGS

/** The lighting's view at `binding` of group 0. */
const viewAt = wgslBlock(
  'HAIR_SKY_AO_VIEW',
  [VIEW_WGSL],
  `@group(0) @binding(${B.view}) var<uniform> view:View;`,
)

/**
 * THE OCCLUSION THE STRANDS GIVE THE SURFACES ABOUT THEM, laid on the image's ambient occlusion: for each pixel that shows a surface, `samples` directions of the cosine lobe about its normal
 * are marched through the voxels of every macro group as far as `distance` (the opaque marks left out of the visibility), each answering
 * the share of the way that is free of hair (`saturate(1 - hairCount)` times the visibility); the occlusion is one less the occluded share to
 * the power `power`, taken to `intensity`, and the least of the groups' and of the occlusion already drawn. A pixel that shows no surface keeps the occlusion drawn.
 */
export const hairSkyAoWgsl = wgslProgram(
  `@group(0) @binding(${B.nodes}) var<storage,read> nodes:array<u32>;
@group(0) @binding(${B.pageIndex}) var<storage,read> pageIndex:array<u32>;
@group(0) @binding(${B.voxels}) var<storage,read> voxels:array<u32>;
struct HairSkyAoParams{
 samples:u32,frame:u32,pad0:u32,pad3:u32,
 distance:f32,power:f32,intensity:f32,densityScale:f32,
 stepping:f32,depthBias:f32,pad1:f32,pad2:f32}
@group(0) @binding(${B.params}) var<uniform> ao:HairSkyAoParams;
@group(0) @binding(${B.source}) var occlusion:texture_2d<f32>;
@group(0) @binding(${B.depth}) var depth:texture_depth_2d;
@group(0) @binding(${B.normals}) var normals:texture_2d<f32>;
@fragment fn hairSkyAoMain(@builtin(position) position:vec4f)->@location(0) vec4f{
 let drawn=textureLoad(occlusion,vec2i(position.xy),0).r;
 let size=vec2f(textureDimensions(occlusion));
 let pixel=vec2i(position.xy*vec2f(textureDimensions(depth))/size);
 let z=textureLoad(depth,pixel,0);
 let stored=textureLoad(normals,pixel,0).xyz;
 if(z<=0.0||length(stored)<=0.0){return vec4f(drawn);}
 let normal=normalize(stored);
 let place=worldAt(vec2f(pixel)+vec2f(0.5),z)-view.display.yzw;
 let seed0=rand3dPcg16(vec3i(vec2i(position.xy),i32(ao.frame%8u))).xy;
 let seed1=rand3dPcg16(vec3i(vec2i(position.xy)+vec2i(17),i32(ao.frame%8u))).xy;
 let basis=frameAround(normal);
 var result=1.0;
 for(var group=0u;group<params.macroGroupCount;group++){
  let node=nodeOf(group);
  var visibility=0.0;
  for(var at=0u;at<ao.samples;at++){
   let e0=hammersley16(at,ao.samples,seed0);
   let e1=hammersley16(at,ao.samples,seed1);
   let direction=outOfFrame(sampleCosineHemisphere(fract(e0)),basis);
   let start=place+node.size*(direction*e1.x+direction*ao.depthBias);
   let traced=traceVoxels(start,start+direction*${AO_MAX_DISTANCE}.0,node,TraversalSettings(ao.densityScale,1.0,ao.distance,ao.stepping,vec3f(0.0),0.0,false,false));
   visibility+=saturate(1.0-traced.hairCount)*traced.visibility;
  }
  visibility/=f32(ao.samples);
  result=min(result,saturate(1.0-(1.0-pow(saturate(visibility),ao.power))*ao.intensity));
 }
 return vec4f(min(drawn,result));
}`,
  [
    VOXEL_PARAMS_WGSL,
    voxelTraversalWgsl(true),
    viewAt,
    WORLD_AT_WGSL,
    FULLSCREEN_VERTEX,
    frameAround,
    outOfFrame,
    hammersley16,
    rand3dPcg16,
    sampleCosineHemisphere,
  ],
)
