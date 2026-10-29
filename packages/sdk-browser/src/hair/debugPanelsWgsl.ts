import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { pixelToNdc, transformHomogeneousPoint } from '../../../math/src/wgsl/projection.ts'
import { interleavedGradientNoise } from '../../../math/src/wgsl/sampling.ts'
import { SCREEN_PASS_VERTEX } from '../diagnostic/screenPass.ts'
import { MAX_MACRO_GROUPS } from './macroGroups.ts'
import { HAIR_VIEW_WGSL } from './ribbonWgsl.ts'
import { HAIR_VOXEL_JITTER_WGSL, voxelTraversalWgsl } from './voxelTraversalWgsl.ts'
import { VOXEL_PARAMS_WGSL } from './voxelWgsl.ts'

/** Where the deep shadows' atlases are drawn: the depth's rectangle, then the layers' beside it (x, y, width, height in pixels). */
const DEBUG_ATLAS_RECTS = {
  depth: [450, 50, 300, 300],
  layers: [750, 50, 300, 300],
} as const
/** The words of the atlas viewer's block (`DebugAtlas`) and of the voxel viewer's (`DebugVoxels`). */
export const DEBUG_ATLAS_WORDS = 4
export const DEBUG_VOXEL_WORDS = 12
/** The pages the view of the pages marches through along a ray, and the farthest the count of the strands is marched, in metres. */
const PAGE_STEPS = 256
const VOXEL_DISTANCE = 100
/** The strands' count that paints a pixel red; fewer run from blue. */
const COUNT_RED = 16

/** Whether a pixel is inside a rectangle (x, y, width, height) and whether it is on its one-pixel border. */
const rectFns = wgslBlock(
  'DEBUG_RECT_WGSL',
  [],
  `fn debugInside(rect:vec4f,p:vec2f)->bool{return p.x>rect.x&&p.x<rect.x+rect.z&&p.y>rect.y&&p.y<rect.y+rect.w;}
fn debugBorder(p:vec2f,rect:vec4f)->bool{
 let local=(p-rect.xy);
 return local.x<1.0||local.x>rect.z-2.0||local.y<1.0||local.y>rect.w-2.0;
}`,
)

/**
 * THE DEEP SHADOWS' ATLASES OVER THE IMAGE: the atlas of the front depths in a square at (450, 50), the atlas of the layers
 * (the values divided by `scale`) in the one beside it, each with a yellow border, read by four texels with a linear filter;
 * every other pixel is left as it is.
 */
export const DEBUG_ATLAS_WGSL = wgslProgram(
  `struct DebugAtlas{scale:f32,pad0:f32,pad1:f32,pad2:f32}
@group(0) @binding(0) var<uniform> atlas:DebugAtlas;
@group(0) @binding(1) var depthAtlas:texture_depth_2d;
@group(0) @binding(2) var layersAtlas:texture_2d<f32>;
const DEPTH_RECT=vec4f(${DEBUG_ATLAS_RECTS.depth.join('.0,')}.0);
const LAYERS_RECT=vec4f(${DEBUG_ATLAS_RECTS.layers.join('.0,')}.0);
// The texel a point of the rectangle falls on, and the weights of the four around it.
fn bilinearDepth(uv:vec2f)->f32{
 let size=vec2f(textureDimensions(depthAtlas));
 let at=uv*size-vec2f(0.5);
 let base=vec2i(floor(at));
 let f=fract(at);
 let top=vec2i(size)-vec2i(1);
 let a=textureLoad(depthAtlas,clamp(base,vec2i(0),top),0);
 let b=textureLoad(depthAtlas,clamp(base+vec2i(1,0),vec2i(0),top),0);
 let c=textureLoad(depthAtlas,clamp(base+vec2i(0,1),vec2i(0),top),0);
 let d=textureLoad(depthAtlas,clamp(base+vec2i(1,1),vec2i(0),top),0);
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
fn bilinearLayers(uv:vec2f)->vec3f{
 let size=vec2f(textureDimensions(layersAtlas));
 let at=uv*size-vec2f(0.5);
 let base=vec2i(floor(at));
 let f=fract(at);
 let top=vec2i(size)-vec2i(1);
 let a=textureLoad(layersAtlas,clamp(base,vec2i(0),top),0).xyz;
 let b=textureLoad(layersAtlas,clamp(base+vec2i(1,0),vec2i(0),top),0).xyz;
 let c=textureLoad(layersAtlas,clamp(base+vec2i(0,1),vec2i(0),top),0).xyz;
 let d=textureLoad(layersAtlas,clamp(base+vec2i(1,1),vec2i(0),top),0).xyz;
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
${SCREEN_PASS_VERTEX}
@fragment fn debugAtlasFs(@builtin(position) position:vec4f)->@location(0) vec4f{
 let p=position.xy;
 var color=vec3f(0.0);
 if(debugInside(DEPTH_RECT,p)){
  color=vec3f(bilinearDepth((p-DEPTH_RECT.xy)/DEPTH_RECT.zw));
  if(debugBorder(p,DEPTH_RECT)){color+=vec3f(1.0,1.0,0.0);}
 }else if(debugInside(LAYERS_RECT,p)){
  color=bilinearLayers((p-LAYERS_RECT.xy)/LAYERS_RECT.zw)/atlas.scale;
  if(debugBorder(p,LAYERS_RECT)){color+=vec3f(1.0,1.0,0.0);}
 }else{discard;}
 return vec4f(color,1.0);
}`,
  [rectFns],
)

/** The colour of a strands' count: blue at the least, red at `COUNT_RED`, black for none. */
const countColor = wgslFn(
  'debugCountColor',
  [],
  `fn debugCountColor(count:f32)->vec3f{
 let x=saturate(count/${COUNT_RED}.0);
 let hue=(1.0-x)*0.6;
 let rgb=saturate(vec3f(abs(hue*6.0-3.0)-1.0,2.0-abs(hue*6.0-2.0),2.0-abs(hue*6.0-4.0)));
 return select(vec3f(0.0),rgb,count>0.0);
}`,
)

/**
 * THE VOXELS OVER THE IMAGE, for each pixel of the display and each macro group of the volume that holds pages: the ray from the eye to the
 * opaque surface behind the pixel is marched (the linear traversal, or the mip one) and the strands' count along it painted
 * (`debugCountColor`); with `drawPages`, the first page of the page index the ray enters (256 steps through the node's box,
 * the ray's start moved by a noise) is painted by its coordinates over 12. The last group that paints a pixel wins. `forcedMip`, 0 or
 * more, is the level of the pages every step reads. Nothing is painted where nothing is found. The host binds the volume as the
 * transmittance does (`params`, `nodes`, `pageIndex`, `voxels`) and the strands' view block.
 */
export const debugVoxelWgsl = (mipmap: boolean) =>
  wgslProgram(
    `struct DebugVoxels{size:vec2f,densityScale:f32,stepping:f32,forcedMip:i32,drawPages:u32,drawVoxels:u32,frame:u32,jitterMode:u32,pad0:u32,pad1:u32,pad2:u32}
@group(0) @binding(1) var<storage,read> nodes:array<u32>;
@group(0) @binding(2) var<storage,read> pageIndex:array<u32>;
@group(0) @binding(3) var<storage,read> voxels:array<u32>;
@group(0) @binding(4) var<uniform> view:HairView;
@group(0) @binding(5) var<uniform> settings:DebugVoxels;
@group(0) @binding(6) var sceneDepth:texture_depth_2d;
${SCREEN_PASS_VERTEX}
@fragment fn debugVoxelFs(@builtin(position) position:vec4f)->@location(0) vec4f{
 let uv=position.xy/settings.size;
 let depth=max(textureLoad(sceneDepth,vec2i(uv*vec2f(textureDimensions(sceneDepth))),0),1e-7);
 let h=transformHomogeneousPoint(view.inverseViewProj,vec3f(pixelToNdc(uv*view.size,view.size),depth));
 let surfacePoint=h.xyz/h.w;
 let origin=vec3f(0.0);
 forcedMip=settings.forcedMip;
 var color=vec3f(0.0);
 var found=false;
 for(var owner=0u;owner<min(params.macroGroupCount,${MAX_MACRO_GROUPS}u);owner++){
  let node=nodeOf(owner);
  if(any(node.pages==vec3u(0u))){continue;}
  if(settings.drawPages!=0u){
   let span=lineBoxIntersect(origin,surfacePoint,node.lo,node.hi);
   if(span.x<span.y){
    let dither=interleavedGradientNoise(position.xy,1.0);
    let delta=(span.y-span.x)/${PAGE_STEPS}.0;
    for(var tick=0u;tick<${PAGE_STEPS}u;tick++){
     let hit=origin+((dither+f32(tick))*delta+span.x)*(surfacePoint-origin);
     let coord=positionToCoord(hit,node.lo,node.hi,node.pages);
     if(pageIndex[coordToIndex(coord,node.pages,node.offset)]!=INVALID_PAGE){
      color=vec3f(coord)/12.0;
      found=true;
      break;
     }
    }
   }
  }else if(settings.drawVoxels!=0u){
   let random=hairVoxelJitter(vec2u(position.xy),0u,settings.frame,settings.jitterMode);
   let traced=traceVoxels(origin,surfacePoint,node,TraversalSettings(settings.densityScale,opaqueVoxelValue(),${VOXEL_DISTANCE}.0,settings.stepping,random,0.0,false,false));
   if(traced.hairCount>0.0){
    color=debugCountColor(traced.hairCount);
    found=true;
   }
  }
 }
 if(!found){discard;}
 return vec4f(color,1.0);
}`,
    [
      VOXEL_PARAMS_WGSL,
      HAIR_VIEW_WGSL,
      voxelTraversalWgsl(mipmap, true),
      HAIR_VOXEL_JITTER_WGSL,
      countColor,
      interleavedGradientNoise,
      pixelToNdc,
      transformHomogeneousPoint,
    ],
  )
