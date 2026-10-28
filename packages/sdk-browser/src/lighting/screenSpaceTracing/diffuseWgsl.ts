import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { frameAround, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import {
  hammersley16,
  interleavedGradientNoise,
  rand3dPcg16,
  uniformDiskConcentric,
} from '../../../../math/src/wgsl/sampling.ts'
import { screenGiConfig } from './screenSpaceQuality.ts'
import {
  SCREEN_SPACE_BINDINGS,
  SCREEN_SPACE_CAST_WGSL,
  SCREEN_SPACE_SURFACE_WGSL,
} from './rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP } from './screenSpaceView.ts'

const B = SCREEN_SPACE_BINDINGS

/** The constants of the tile, the workgroup memory, the outputs and the helpers of a lane. */
const diffuseDeclarationsText = (tileX: number, tileY: number, rays: number) => {
  const tilePixels = tileX * tileY
  const lanes = tilePixels * rays
  return `const TILE_X:u32=${tileX}u;
const TILE_Y:u32=${tileY}u;
const TILE_PIXELS:u32=${tilePixels}u;
const RAYS:u32=${rays}u;
const LANES:u32=${lanes}u;
var<workgroup> lanesColor:array<u32,${lanes * 2}>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.out}) var diffuseOut:texture_storage_2d<rgba16float,write>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.outSecond}) var occlusionOut:texture_storage_2d<r32float,write>;
fn compressNormal(n:vec3f)->u32{
 let k=vec3u(saturate(n*0.5+vec3f(0.5))*255.0);
 return k.x|(k.y<<8u)|(k.z<<16u);
}
fn decompressNormal(e:u32)->vec3f{
 let k=vec3u(e&0xffu,(e>>8u)&0xffu,(e>>16u)&0xffu);
 return vec3f(k)*(2.0/255.0)-vec3f(1.0);
}
fn lanePixel(group:vec2u,pixel:u32)->vec2u{
 return group*vec2u(TILE_X,TILE_Y)+vec2u(pixel%TILE_X,(pixel/TILE_X)%TILE_Y);
}
/** The full-resolution pixel position a tracing pixel stands for. */
fn fullPosition(pixel:vec2u)->vec2f{return vec2f(pixel)*ssView.reducedLimit.z+vec2f(ssView.reducedLimit.w);}
fn cosineRay(viewN:vec3f,e:vec2f)->vec3f{
 let d=uniformDiskConcentric(e);
 return outOfFrame(vec3f(d,sqrt(max(1.0-dot(d,d),0.0))),frameAround(viewN));
}
`
}

/** The kernel's start: the gather of the tile's surfaces, then the cast of each lane's ray and the light it reads where it hits. */
const diffuseTraceText = (
  tileX: number,
  tileY: number,
  rays: number,
  steps: number,
) => `@compute @workgroup_size(${tileX},${tileY},${rays})
fn diffuseCompute(@builtin(workgroup_id) group3:vec3u,@builtin(local_invocation_index) index:u32){
 let group=group3.xy;
 let pixelId=index%TILE_PIXELS;
 let rayId=index/TILE_PIXELS;
 let size=vec2i(ssView.size.xy);
 if(rayId==0u){
  let full=fullPosition(lanePixel(group,pixelId));
  let at=ssClampPixel(vec2i(floor(full)),size);
  let surface=ssSurfaceAt(at);
  let z=hizOpaqueDepth(at);
  let traced=surface.valid&&z>0.0;
  lanesColor[pixelId]=compressNormal((ssView.worldToView*vec4f(surface.N,0.0)).xyz);
  lanesColor[TILE_PIXELS+pixelId]=bitcast<u32>(select(-1.0,z,traced));
 }
 workgroupBarrier();
 let packedNormal=lanesColor[pixelId];
 let deviceZ=bitcast<f32>(lanesColor[TILE_PIXELS+pixelId]);
 workgroupBarrier();
 var color=vec2u(0u);
 if(deviceZ>0.0){
  let viewN=decompressNormal(packedNormal);
  let pixel=lanePixel(group,pixelId);
  let screen=ssScreenOfPixel(fullPosition(pixel));
  let stepOffset=interleavedGradientNoise(vec2f(pixel)+vec2f(0.5),f32(ssView.frame.x))-0.9;
  let random=rand3dPcg16(vec3i(vec2i(pixel),i32(ssView.frame.x))).xy;
  let e=hammersley16(rayId,RAYS,random);
  let ray=ssRayFromView(screen,deviceZ,cosineRay(viewN,e));
  let marched=ssCast(ray,1.0,${steps}u,stepOffset,1.0);
  if(marched.found){
   let uv=min(marched.hit.xy*ssView.reduced.xy+ssView.reduced.zw,ssView.reducedLimit.xy);
   let sampled=textureSampleLevel(colorImage,colorSampler,uv,marched.level);
   let diffuse=sampled.rgb/(1.0+dot(sampled.rgb,vec3f(0.3,0.59,0.11)));
   color=vec2u(pack2x16float(diffuse.rg),pack2x16float(vec2f(diffuse.b,1.0)));
  }
 }
`

/** The kernel's end: the lanes' light written to the workgroup memory, then the average of each pixel's rays written out. */
const DIFFUSE_AVERAGE_TEXT = ` let dest=pixelId+rayId*TILE_PIXELS;
 lanesColor[dest]=color.x;
 lanesColor[LANES+dest]=color.y;
 workgroupBarrier();
 if(index<TILE_PIXELS){
  var sum=vec3f(0.0);
  var hits=0.0;
  for(var r=0u;r<RAYS;r++){
   let src=index+r*TILE_PIXELS;
   let rg=unpack2x16float(lanesColor[src]);
   let ba=unpack2x16float(lanesColor[LANES+src]);
   sum+=vec3f(rg,ba.x);
   hits+=ba.y;
  }
  var diffuse=sum/f32(RAYS);
  diffuse=diffuse/(1.0-dot(diffuse,vec3f(0.3,0.59,0.11)));
  let occlusion=1.0-hits/f32(RAYS);
  let outPixel=vec2i(lanePixel(group,index));
  let extent=vec2i(textureDimensions(diffuseOut));
  if(all(outPixel<extent)){
   textureStore(diffuseOut,outPixel,vec4f(diffuse,1.0));
   textureStore(occlusionOut,outPixel,vec4f(occlusion,0.0,0.0,0.0));
  }
 }
}`

/**
 * THE INDIRECT DIFFUSE LIGHT FROM THE SCREEN (diffuseCompute) at the quality level (1 to 4): a workgroup traces a tile of pixels, a
 * lane a pixel's ray — the lanes are 256: 4, 8, 16 or 32 rays a pixel over a tile of 8 by 8, 8 by 4, 4 by 4 or 4 by 2 pixels. The group's
 * first lanes gather the tile's surfaces (the normal in the view, packed on three bytes, and the depth, negative where nothing is traced)
 * into the workgroup memory; each lane then casts the cosine-weighted ray its Hammersley point (scrambled per pixel and frame) draws
 * about the pixel's normal, through the depth pyramid, and where it hits reads the reduced chain of the last lit image at the level the
 * march ended on, weighted by one over one plus its luminance; the first lanes then average a pixel's rays (an unhit ray brings nothing,
 * and the occlusion is the share that hit), the weight undone, and write the light and the occlusion (one less the share).
 * The image is traced at 1 or 2 pixels per texel (reducedLimit.z, the offset w).
 */
export const diffuseWgsl = (level: number) => {
  const { rays, steps, tileX, tileY } = screenGiConfig(level)
  return wgslProgram(
    diffuseDeclarationsText(tileX, tileY, rays) +
      diffuseTraceText(tileX, tileY, rays, steps) +
      DIFFUSE_AVERAGE_TEXT,
    [
      SCREEN_SPACE_CAST_WGSL(true),
      SCREEN_SPACE_SURFACE_WGSL,
      interleavedGradientNoise,
      rand3dPcg16,
      hammersley16,
      uniformDiskConcentric,
      frameAround,
      outOfFrame,
    ],
  )
}
