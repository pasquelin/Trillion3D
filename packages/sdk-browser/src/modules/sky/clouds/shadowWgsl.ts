import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  LARGEST_SMALL_FLOAT as MOST_10_BIT,
  MOST_11_BIT,
} from '../../../post/taa/colorSpaceWgsl.ts'
import { airProgram, type AirBindings } from '../../../lighting/atmosphere/programs.ts'
import { cloudMaterialBindings } from './materialWgsl.ts'
import {
  CLOUD_SHADOW_BINDING as B,
  CLOUD_SHADOW_FORMAT,
  CLOUD_SHADOW_GROUP as G,
  CLOUD_SHADOW_GROUP_SIZE,
  CLOUD_SHADOW_LAYOUT,
  CLOUD_SHADOW_TEMPORAL_BINDING as T,
  CLOUD_SHADOW_TEMPORAL_LAYOUT,
} from './shadowLayout.ts'
import { CLOUD_POINT_WGSL } from './traceLightWgsl.ts'

/**
 * THE MAP'S VALUES AS THE 11/11/10 BIT FLOAT FORMAT HOLDS THEM (`CLOUD_SHADOW_FORMAT`): the first
 * two channels as unsigned floats of a 5 bit exponent and a 6 bit mantissa, the third of a 5 bit
 * exponent and a 5 bit mantissa. `cloudShadowStore(v)` rounds each channel of `v` to the
 * nearest value its format holds, a tie to the even one; a negative is 0, a value past the
 * format's largest is that largest (65024 for the first two, 64512 for the third); the values under
 * the smallest normal (2^-14) are rounded on the grid of that exponent. The result is written with
 * a fourth channel of 0.
 *
 * The step of a channel at a value is 2^(exponent - mantissa bits), built from the float's own
 * exponent bits so that it is exact.
 */
export const CLOUD_SHADOW_ROUND = wgslBlock(
  'CLOUD_SHADOW_ROUND',
  [],
  `
fn cloudShadowRoundTo(x:f32,mantissaBits:i32,most:f32)->f32{
 let v=max(x,0.0);
 let exponent=max(i32((bitcast<u32>(v)>>23u)&255u)-127,-14);
 let step=bitcast<f32>(u32(exponent-mantissaBits+127)<<23u);
 return min(round(v/step)*step,most);
}
fn cloudShadowStore(v:vec3f)->vec4f{
 return vec4f(cloudShadowRoundTo(v.x,6,${MOST_11_BIT}.0),cloudShadowRoundTo(v.y,6,${MOST_11_BIT}.0),cloudShadowRoundTo(v.z,5,${MOST_10_BIT}.0),0.0);
}`,
)

/** What the trace binds of the air, in group 0: the light buffer and the image's frame. */
export const CLOUD_SHADOW_AIR: AirBindings = { air: 'read', frame: true }

/**
 * THE CLOUD SHADOW MAP'S TRACE, one thread to a texel of the map: a ray from the map's near plane
 * along the light's rays, through the cloud layer's shell, the material read at evenly spaced
 * samples.
 *
 * The ray is cut to the shell (`shadowRay`). It misses the top: the texel holds the far depth and
 * nothing else. It meets the bottom too and does not see the bottom from outside: the texel holds
 * zeros, a ray that starts under the layer is not shadowed. Else it takes `samples` steps of the
 * length over the count, the first half a step in, no jitter. A sample whose conservative density
 * is not above 0 is passed. The others add their extinction, and its product with the step to the
 * optical depth; the nearest to hold any medium gives the front depth. The texel holds the front
 * depth plus the bias, not below 0 (the whole path's end where there is none), the mean extinction
 * of the samples that held a medium, and the optical depth, the last two times the light's strength.
 *
 * The textures of the material are read at the level of the sample's footprint on the map: how far
 * the sample moves for a texel to the right and one below, the neighbouring texels' rays taken at the
 * same step (`shadowFootprint`), as the quad of a pixel shader gives the reference its derivatives.
 *
 * Lengths are centimetres; the shell is intersected in kilometres from the planet's centre.
 */
const TRACE_OWN = `${CLOUD_SHADOW_LAYOUT.wgsl}
@group(${G}) @binding(${B.block}) var<uniform> cloudShadow:CloudShadowBlock;${cloudMaterialBindings(G, B.material)}
@group(${G}) @binding(${B.output}) var shadowOut:texture_storage_2d<${CLOUD_SHADOW_FORMAT},write>;
const SHADOW_RAY_HITS=0u;
const SHADOW_RAY_MISSES=1u;
const SHADOW_RAY_UNDER=2u;
struct ShadowRay{near:vec3f,tMin:f32,span:f32,status:u32,}
fn shadowRay(p:vec2u)->ShadowRay{
 var r:ShadowRay;
 let uv=((vec2f(p)+0.5)*cloudShadow.pixel.xy+cloudShadow.pixel.zw)*cloudShadow.texel.zw;
 let clip=vec4f(uv*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),1.0,1.0);
 let h=cloudShadow.cameraFromClip*clip;
 r.near=h.xyz/h.w;
 r.status=SHADOW_RAY_HITS;
 let dir=cloudShadow.ray.xyz;
 let bottomKm=cloudShadow.layer.w+cloudShadow.layer.x;
 let topKm=bottomKm+cloudShadow.layer.y;
 let originKm=(cloudPlanetEye+r.near)*CLOUD_CM_TO_KM;
 let tTop=raySphere(originKm,dir,topKm);
 if(all(tTop==vec2f(-1.0))){r.status=SHADOW_RAY_MISSES;return r;}
 var low=tTop.x;
 var high=tTop.y;
 let tBottom=raySphere(originKm,dir,bottomKm);
 if(any(tBottom!=vec2f(-1.0))){
  if(!all(tBottom>vec2f(0.0))){r.status=SHADOW_RAY_UNDER;return r;}
  let bottomEnd=min(tBottom.x,tBottom.y);
  let topEnd=max(0.0,min(tTop.x,tTop.y));
  low=min(bottomEnd,topEnd);
  high=max(bottomEnd,topEnd);
 }
 r.tMin=max(0.0,low)*CM_PER_KM;
 r.span=max(0.0,high)*CM_PER_KM-r.tMin;
 return r;
}
fn shadowSpot(r:ShadowRay,along:f32)->vec3f{
 let dir=cloudShadow.ray.xyz;
 return (r.near+dir*r.tMin)+dir*(r.span*along);
}
/** The ray of a texel beside \`p\` along \`step\`, the one on the other side (signed -1) where it
 *  misses the layer. */
struct ShadowPartner{ray:ShadowRay,sign:f32,}
fn shadowPartner(p:vec2u,step:vec2u)->ShadowPartner{
 var q:ShadowPartner;
 q.ray=shadowRay(p+step);
 q.sign=1.0;
 if(q.ray.status!=SHADOW_RAY_HITS&&p.x>=step.x&&p.y>=step.y){
  q.ray=shadowRay(p-step);
  q.sign=-1.0;
 }
 return q;
}
/** How far the sample at \`along\` of the ray \`r\` moves for a texel to the right (\`qx\`) and one below
 *  (\`qy\`), from the rays of those neighbours at the same step: none where the neighbour misses the
 *  layer. Sets what the material picks its textures' level from. */
fn shadowFootprint(r:ShadowRay,qx:ShadowPartner,qy:ShadowPartner,along:f32){
 let here=shadowSpot(r,along);
 let dx=select(vec3f(0.0),qx.sign*(shadowSpot(qx.ray,along)-here),qx.ray.status==SHADOW_RAY_HITS);
 let dy=select(vec3f(0.0),qy.sign*(shadowSpot(qy.ray,along)-here),qy.ray.status==SHADOW_RAY_HITS);
 cloudDdx=vec3f(dx.x,dx.z,dx.y);
 cloudDdy=vec3f(dy.x,dy.z,dy.y);
}
fn shadowTrace(p:vec2u)->vec3f{
 let farKm=cloudShadow.ray.w;
 let ray=shadowRay(p);
 if(ray.status==SHADOW_RAY_MISSES){return vec3f(farKm,0.0,0.0);}
 if(ray.status==SHADOW_RAY_UNDER){return vec3f(0.0);}
 let qx=shadowPartner(p,vec2u(1u,0u));
 let qy=shadowPartner(p,vec2u(0u,1u));
 var extinctionSum=vec3f(0.0);
 var extinctionCount=0.0;
 var opticalDepth=vec3f(0.0);
 let farCm=farKm*CM_PER_KM;
 var nearest=farCm;
 let count=cloudShadow.output.z;
 let inverseCount=1.0/count;
 let stepMeters=ray.span*CLOUD_CM_TO_M/count;
 for(var s=0.5;s<count;s+=1.0){
  let along=s*inverseCount;
  shadowFootprint(ray,qx,qy,along);
  let spot=cloudPointAt(shadowSpot(ray,along)).spot;
  if(spot.conservativeDensity.x<=0.0){continue;}
  let present=any(spot.extinction>vec3f(0.0));
  nearest=select(nearest,min(nearest,ray.span*along),present);
  extinctionSum+=spot.extinction;
  opticalDepth+=spot.extinction*stepMeters;
  extinctionCount+=select(0.0,1.0,present);
 }
 let strength=cloudShadow.output.x;
 let grey=vec3f(1.0/3.0);
 let meanExtinction=strength*dot(extinctionSum/max(1.0,extinctionCount),grey);
 let maxOpticalDepth=strength*dot(opticalDepth,grey);
 let tMax=ray.tMin+ray.span;
 let front=select((ray.tMin+nearest)*CLOUD_CM_TO_KM,tMax*CLOUD_CM_TO_KM,nearest==farCm);
 return vec3f(max(0.0,front+cloudShadow.output.y),meanExtinction,maxOpticalDepth);
}
@compute @workgroup_size(${CLOUD_SHADOW_GROUP_SIZE},${CLOUD_SHADOW_GROUP_SIZE},1)
fn cloudShadowMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=u32(cloudShadow.texel.x)||id.y>=u32(cloudShadow.texel.y)){return;}
 cloudPointStart(cloudShadow.layer.xyz,cloudShadow.layer.w);
 textureStore(shadowOut,id.xy,cloudShadowStore(shadowTrace(id.xy)));
}`

/** The trace's whole program (`CLOUD_SHADOW_TRACE_ENTRY`). */
export const CLOUD_SHADOW_TRACE_PROGRAM = airProgram(CLOUD_SHADOW_AIR, TRACE_OWN, [
  CLOUD_POINT_WGSL,
  CLOUD_SHADOW_ROUND,
])
export const CLOUD_SHADOW_TRACE_ENTRY = 'cloudShadowMain'

/** Where the filter binds what it reads and writes, in its own group 0. */
export const CLOUD_SHADOW_FILTER_BINDING = { source: 0, destination: 1 } as const

/**
 * THE SPATIAL FILTER, one pass, one thread to a texel of the map it writes, half the size of the
 * map it reads: the four texels of the map above it are reduced to one.
 *
 * The depth of a texel is the SUM of the four depths, less the mean of their distances from that
 * sum, as the reference does it: a sum, not a mean, so four equal depths d give 4d less 3d, which
 * is d, and unequal ones a value no mean-based filter gives. The mean extinction and the optical
 * depth are the means of the four. A texel reads the four of the larger map under it; the
 * smaller map is cut to a whole half, so none is read past its edge.
 */
export const CLOUD_SHADOW_FILTER_PROGRAM = wgslProgram(
  `
@group(0) @binding(${CLOUD_SHADOW_FILTER_BINDING.source}) var source:texture_2d<f32>;
@group(0) @binding(${CLOUD_SHADOW_FILTER_BINDING.destination}) var destination:texture_storage_2d<${CLOUD_SHADOW_FORMAT},write>;
@compute @workgroup_size(${CLOUD_SHADOW_GROUP_SIZE},${CLOUD_SHADOW_GROUP_SIZE},1)
fn cloudShadowFilterMain(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(destination))){return;}
 let at=vec2i(id.xy)*2;
 let d0=textureLoad(source,at,0).xyz;
 let d1=textureLoad(source,at+vec2i(1,0),0).xyz;
 let d2=textureLoad(source,at+vec2i(1,1),0).xyz;
 let d3=textureLoad(source,at+vec2i(0,1),0).xyz;
 let mean=d0.x+d1.x+d2.x+d3.x;
 let deviation=(abs(d0.x-mean)+abs(d1.x-mean)+abs(d2.x-mean)+abs(d3.x-mean))*0.25;
 let extinction=(d0.y+(d1.y+d2.y+d3.y))*(1.0/4.0);
 let depth=(d0.z+(d1.z+d2.z+d3.z))*(1.0/4.0);
 textureStore(destination,id.xy,cloudShadowStore(vec3f(mean-deviation,extinction,depth)));
}`,
  [CLOUD_SHADOW_ROUND],
)
export const CLOUD_SHADOW_FILTER_ENTRY = 'cloudShadowFilterMain'

/**
 * THE TEMPORAL FILTER (`shadowHistory.ts`), one thread to a texel of the whole map: the texel
 * takes the traced pixel under it (the traced map is half the size when it runs), and the pixel
 * of the whole map that pixel stands for this image is the one at the pixel scale and offset.
 *
 * With a history, the texel's position in this image's map is taken back to the camera's
 * coordinates and into the previous image's map, where the previous values are read bilinearly. When
 * the point the map looks at has moved, the previous front depth is replaced by its value along the
 * current rays. A texel that is the traced pixel of this image takes
 * `previous + weight (current - previous)` and keeps the current depth; any other keeps the
 * previous values. Without a history a texel takes the traced one. The result is not below 0.
 */
export const CLOUD_SHADOW_TEMPORAL_PROGRAM = wgslProgram(
  `${CLOUD_SHADOW_TEMPORAL_LAYOUT.wgsl}
@group(0) @binding(${T.block}) var<uniform> temporal:CloudShadowTemporalBlock;
@group(0) @binding(${T.current}) var current:texture_2d<f32>;
@group(0) @binding(${T.previous}) var previous:texture_2d<f32>;
@group(0) @binding(${T.destination}) var destination:texture_storage_2d<${CLOUD_SHADOW_FORMAT},write>;
@group(0) @binding(${T.sampler}) var historySampler:sampler;
@compute @workgroup_size(${CLOUD_SHADOW_GROUP_SIZE},${CLOUD_SHADOW_GROUP_SIZE},1)
fn cloudShadowTemporalMain(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(destination))){return;}
 let center=vec2i(id.xy);
 let uv=(vec2f(id.xy)+0.5)*temporal.size.zw;
 let scale=vec2i(temporal.pixel.xy);
 let tracedCoord=center/scale;
 let newCoord=tracedCoord*scale+vec2i(temporal.pixel.zw);
 var filtered:vec3f;
 if(temporal.blend.y!=0.0){
  let clip=vec4f(uv*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),0.0,1.0);
  let home=temporal.cameraFromClip*clip;
  let camera=home.xyz/home.w;
  var before=temporal.previousClipFromCamera*vec4f(camera,1.0);
  before=before/before.w;
  let beforeUv=0.5+vec2f(0.5,-0.5)*before.xy;
  var past=textureSampleLevel(previous,historySampler,beforeUv,0.0).xyz;
  if(temporal.blend.z!=0.0){past.x=temporal.depth.x+temporal.depth.y*past.x;}
  filtered=past;
  if(all(newCoord==center)){
   let now=textureLoad(current,tracedCoord,0).xyz;
   filtered=past+temporal.blend.x*(now-past);
   filtered.x=now.x;
  }
 }else{
  filtered=textureLoad(current,tracedCoord,0).xyz;
 }
 textureStore(destination,id.xy,cloudShadowStore(max(vec3f(0.0),filtered)));
}`,
  [CLOUD_SHADOW_ROUND],
)
export const CLOUD_SHADOW_TEMPORAL_ENTRY = 'cloudShadowTemporalMain'
