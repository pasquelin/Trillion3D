import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { cloudMaterialBindings } from '../../modules/sky/clouds/materialWgsl.ts'
import { PT_CLOUD_MAP_FORMAT, PT_CLOUD_POINT_WGSL, PT_CLOUD_STRUCT } from './cloudMediumWgsl.ts'
import { PT_RANDOM_WGSL } from './randomWgsl.ts'

/** The entry of the kernel that builds the clouds' acceleration map, and the bindings of its group: the clouds' block, the map of the image before and the one written, then the cloud material from `material`. */
export const PT_CLOUD_MAP_ENTRY = 'ptCloudMapBuild'
export const PT_CLOUD_MAP_BINDINGS = { params: 0, previous: 1, map: 2, material: 3 } as const

const B = PT_CLOUD_MAP_BINDINGS

/**
 * THE CLOUDS' ACCELERATION MAP (`ptCloudMapBuild`), made at each image: a texel is a column of the clip box about the eye, `reach` kilometres a side over the map's side, and the kernel reads the material at
 * `numSamples` points of it (each image's own, drawn from the sequence of the texel and the sample: a point of the column jittered across it and along the layer, the layer's shell seen from the clip frame's
 * up axis) and keeps, from what the images before it kept (none at the first sample of a run, so that a camera that moved starts again): the densest extinction (the greatest of the channels), the least, and the lowest
 * and highest heights, from the eye's plane, a point with some extinction was found at. A point with emission and no extinction counts as one of an extinction that gives a step a texel, so that the march takes some in
 * the empty stretches of a glowing cloud. The map bounds the march (`ptCloudIntersect`, `ptCloudMarch`) and grows tighter as the samples of a run add up.
 */
const PT_CLOUD_MAP_KERNEL_WGSL = wgslBlock(
  'PT_CLOUD_MAP_KERNEL_WGSL',
  [PT_CLOUD_POINT_WGSL, PT_RANDOM_WGSL],
  `const PT_CLOUD_FAR:f32=3.0e38;
@compute @workgroup_size(8,8,1)
fn ${PT_CLOUD_MAP_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let side=ptCloud.options.x;
 if(any(id.xy>=vec2u(side))){return;}
 cloudMaterialStart(ptCloud.centre.w);
 let top=ptCloud.layer.y;
 let bottom=ptCloud.layer.x;
 let reach=ptCloud.layer.z;
 var densest=0.0;
 var thinnest=PT_CLOUD_FAR;
 var low=PT_CLOUD_FAR;
 var high=-PT_CLOUD_FAR;
 if(ptCloud.options.w>0u){
  let kept=textureLoad(ptCloudMap,vec2i(id.xy),0);
  densest=kept.x;
  thinnest=kept.y;
  low=kept.z;
  high=kept.w;
 }
 let samples=ptCloud.options.z;
 for(var s=0u;s<samples;s++){
  var rand=ptRandCreate(id.x+id.y*65536u,ptCloud.options.w*samples+s);
  let jitter=ptRand3(&rand);
  let uv=2.0*((vec2f(id.xy)+jitter.xy)/f32(side))-1.0;
  var clip=vec3f(reach*uv,0.0);
  let r2=dot(clip.xy,clip.xy);
  clip.z=mix(sqrt(max(bottom*bottom-r2,0.0)),sqrt(max(top*top-r2,0.0)),jitter.z);
  let height=clip.z-ptCloud.layer.w;
  let scene=ptCloud.centre.xyz+(ptCloud.clipX.xyz*clip.x+ptCloud.clipY.xyz*clip.y+ptCloud.clipZ.xyz*clip.z)*1000.0;
  let found=ptCloudSampleAt(scene-ptCloudEye(),length(clip));
  var density=max(found.extinction.x,max(found.extinction.y,found.extinction.z));
  let least=min(found.extinction.x,min(found.extinction.y,found.extinction.z));
  if(density==0.0&&any(found.emission>vec3f(0.0))){density=ptCloud.march.z;}
  if(density>0.0){
   low=min(low,height);
   high=max(high,height);
  }
  densest=max(densest,density);
  thinnest=min(thinnest,least);
 }
 textureStore(ptCloudMapOut,vec2i(id.xy),vec4f(densest,thinnest,low,high));
}`,
)

/** The map's build program: the clouds' block, the map before and the map written, the cloud material, and the kernel. */
export const PT_CLOUD_MAP_WGSL = wgslProgram(
  `${PT_CLOUD_STRUCT}
@group(0) @binding(${B.params}) var<uniform> ptCloud:PtCloud;
@group(0) @binding(${B.previous}) var ptCloudMap:texture_2d<f32>;
@group(0) @binding(${B.map}) var ptCloudMapOut:texture_storage_2d<${PT_CLOUD_MAP_FORMAT},write>;
${cloudMaterialBindings(0, B.material)}`,
  [PT_CLOUD_MAP_KERNEL_WGSL],
)
