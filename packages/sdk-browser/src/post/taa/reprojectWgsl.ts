import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { PI, TWO_PI } from '../../../../math/src/wgsl/constants.ts'
import { ndcToPixel } from '../../../../math/src/wgsl/projection.ts'
import { clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import { DEPTH_WGSL } from './depthWgsl.ts'
import {
  HOLE_FILL_WGSL,
  OCCLUDER_WORD_WGSL,
  REPROJECTION_VECTOR_WGSL,
  SHARE_CODE_MASK,
  TEXEL_TILE,
  VECTOR_FORMAT,
} from './velocityWgsl.ts'
import { CATMULL_ROM_TAPS_WGSL } from './historyWgsl.ts'
import { CAMERA_MOTION_WGSL } from './nearestSurfaceWgsl.ts'
import { COLOR_SPACES_WGSL, DITHER_WGSL, quantizationError } from './colorSpaceWgsl.ts'
import { TILE_CLAMP_WGSL } from './tileWgsl.ts'

/** The reprojection pass's bindings. */
export const REPROJECT_BINDINGS = {
  view: 0,
  marks: 1,
  closest: 2,
  vectors: 3,
  occluders: 4,
  prevShading: 5,
  historySampler: 6,
  prevFlicker: 7,
  shading: 8,
  flicker: 9,
  word: 10,
  filled: 11,
  prevThin: 12,
  depth: 13,
} as const

/** The render-resolution histories: the shading history (the colour in the perceptual space and the reprojection
 *  edge it was made at) and the flicker measure. */
export const SHADING_HISTORY_FORMAT: GPUTextureFormat = 'rgba8unorm'
export const FLICKER_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** The reprojection's word per render texel: the reprojection bits (`REPROJECT_BITS`), the code
 *  of the most of its history the texel's surface keeps above them (`SHARE_CODE_SHIFT`), the
 *  reprojection edge in the eight bits above that and the last image's thin geometry coverage
 *  history in the eight above that (`thinGeometryWgsl.ts`). */
export const REPROJECTED_FORMAT: GPUTextureFormat = 'r32uint'

/** The reprojection bits: off the last screen, disoccluded by parallax, pixel animation, and
 *  disoccluded with the velocity of the occluder it took (hole-filled), which only a diagnostic
 *  view reads (`rejectionWgsl.ts`). */
export const REPROJECT_BITS = {
  offScreen: 1,
  disoccluded: 2,
  animated: 4,
  filled: 8,
} as const

/**
 * The reprojection's word of render texel `c` as the later passes read it, through their binding
 * `reprojected`, read once (`reprojectedWord`): whether the texel is a pixel animation, whether
 * its history restarts (off the last screen or disoccluded), and its reprojection edge.
 */
export const REPROJECTED_WORD_WGSL = wgslBlock(
  'REPROJECTED_WORD_WGSL',
  [],
  `
fn reprojectedWord(c:vec2i)->u32{return textureLoad(reprojected,c,0).r;}
fn isAnimated(word:u32)->bool{return (word&${REPROJECT_BITS.animated}u)!=0u;}
fn isRestarted(word:u32)->bool{return (word&${REPROJECT_BITS.offScreen | REPROJECT_BITS.disoccluded}u)!=0u;}
fn reprojectionEdge(word:u32)->f32{return f32((word>>8u)&0xffu)/255.0;}`,
)

/**
 * The history reprojection, per render texel, after the nearest velocity (`velocityWgsl.ts`), reprojecting the
 * render-resolution histories to this image:
 * - the texel's reprojection vector, the velocity dilated (`dilatedVector`): the velocity stage's
 *   word at the closest surface of its 3×3, the offset the nearest velocity kept in the marks, where
 *   that surface moves by itself; else the camera's motion at the texel with the closest surface's
 *   depth (`cameraOnlyMotion`), the stage's own word where it took no neighbour's;
 * - the reprojection edge over the 3×3's reprojection vectors: for each of the four pairs of opposite
 *   neighbours, one less the share of a render pixel each one's vector differs from the texel's
 *   along its own offset, the least of them, times 1.1; the velocity pass's own edge where it exceeds
 *   0.9, and none (one) where the texel took no neighbour's velocity, whose vectors are not read;
 * - the shading history read at the reprojected point with the five-tap Catmull-Rom (`catmullRomTaps`), its
 *   exposure corrected (`view.exposure.y`), dithered to its eight bits; the flicker measure read at
 *   the nearest texel to the point moved by up to half a texel at random. Off the last screen or on
 *   a cut, the histories are read but marked off screen;
 * - the parallax disocclusion: the closest occluders scattered where they stood (`velocityWgsl.ts`)
 *   read on the 2×2 around the texel's last position, each weighing how close its depth lies to the
 *   texel's own last depth — within three pixel diameters at its depth and the texel's own depth
 *   error —; where the hole-filling velocity of the closest of them matches the texel's own, the
 *   test is passed by that match; disoccluded below a half. A disoccluded texel takes that velocity
 *   as its reprojection, when it is one, so the history update reads the surface the occluder left;
 * - the thin geometry coverage history at the texel the reprojected point falls in, kept in the word
 *   for the thin geometry detection (`thinGeometryWgsl.ts`).
 * A vector load, a marks load and a depth load where the texel took a neighbour's velocity, and 9
 * of each for its edge, 5 bilinear shading history taps, a flicker history load, a coverage history load and 4 occluder words per render texel.
 */
export const reprojectShader = () =>
  wgslProgram(
    `@group(0) @binding(${REPROJECT_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${REPROJECT_BINDINGS.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${REPROJECT_BINDINGS.closest}) var closest:texture_2d<u32>;
@group(0) @binding(${REPROJECT_BINDINGS.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${REPROJECT_BINDINGS.occluders}) var<storage,read> occluders:array<u32>;
@group(0) @binding(${REPROJECT_BINDINGS.prevShading}) var prevShading:texture_2d<f32>;
@group(0) @binding(${REPROJECT_BINDINGS.historySampler}) var historySampler:sampler;
@group(0) @binding(${REPROJECT_BINDINGS.prevFlicker}) var prevFlicker:texture_2d<f32>;
@group(0) @binding(${REPROJECT_BINDINGS.shading}) var shadingOut:texture_storage_2d<${SHADING_HISTORY_FORMAT},write>;
@group(0) @binding(${REPROJECT_BINDINGS.flicker}) var flickerOut:texture_storage_2d<${FLICKER_FORMAT},write>;
@group(0) @binding(${REPROJECT_BINDINGS.word}) var reprojectedOut:texture_storage_2d<${REPROJECTED_FORMAT},write>;
@group(0) @binding(${REPROJECT_BINDINGS.filled}) var filledOut:texture_storage_2d<${VECTOR_FORMAT},write>;
@group(0) @binding(${REPROJECT_BINDINGS.prevThin}) var prevThin:texture_2d<u32>;
@group(0) @binding(${REPROJECT_BINDINGS.depth}) var depth:texture_depth_2d;
fn dilatedVector(n:vec2i)->vec2f{
 let code=textureLoad(marks,n,0).a&0xfu;
 let offset=vec2i(i32(code&3u),i32((code>>2u)&3u))-vec2i(1);
 let q=clampTexel(n+offset);
 let word=textureLoad(vectors,q,0).r;
 if(hasOwnMotion(word)||all(offset==vec2i(0))){return decodeVector(word);}
 return cameraOnlyMotion(screenOfTexel(n),textureLoad(depth,q,0));
}
fn neighbourEdge(p:vec2i)->f32{
 var v:array<vec2f,9>;
 for(var k=0;k<9;k++){v[k]=pixelVelocity(dilatedVector(clampTexel(p+vec2i(k%3-1,k/3-1))));}
 let centre=v[4];
 var edge=1.0;
 for(var k=0;k<4;k++){
  let o=vec2i(k%3-1,k/3-1);
  let d0=centre-v[4+o.x+3*o.y];let d1=centre-v[4-o.x-3*o.y];
  let e0=1.0-dot(saturate(abs(d0*vec2f(o))),vec2f(1.0));
  let e1=1.0-dot(saturate(abs(d1*vec2f(-o))),vec2f(1.0));
  edge=min(edge,min(e0,e1));
 }
 return saturate(edge*1.1);
}
fn exposedShading(g:vec3f)->vec3f{return max(linearToPerceptual(perceptualToLinear(g)*view.exposure.y),vec3f(0.0));}
struct TaaParallax{disoccluded:bool,velocity:vec2f,canFill:bool}
fn parallaxTest(screen:vec2f,v:vec2f,prevZ:f32,zError:f32,offScreen:bool)->TaaParallax{
 let size=vec2i(view.render.xy);
 let worldDepth=sceneDepthOf(prevZ);
 let worldDepthError=abs(worldDepth-sceneDepthOf(prevZ+zError));
 let r=ndcToPixel(screen-v,view.render.xy)-0.5;
 let base=vec2i(floor(r));let f=r-vec2f(base);
 let ortho=view.radius.w!=0.0;
 let count=u32(size.x)*u32(size.y);
 var mask=0.0;var anyValid=false;var fill=0u;var nearest=0.0;
 for(var j=0u;j<4u;j++){
  let d=vec2i(i32(j&1u),i32(j>>1u));let at=base+d;
  if(any(at<vec2i(0))||any(at>=size)){continue;}
  let w=mix(1.0-f.x,f.x,f32(d.x))*mix(1.0-f.y,f.y,f32(d.y));
  let index=u32(at.y)*u32(size.x)+u32(at.x);
  let word=occluders[index];
  var z=0.0;
  if(ortho){
   let low=occluders[count+index];
   z=orthoOccluderDepth(word);
   if(z>nearest){nearest=z;fill=orthoOccluderFill(word,low);}
  }else{
   z=occluderDepth(word);
   fill=max(fill,word);
  }
  let depth=sceneDepthOf(z);
  let epsilon=pixelRadiusAt(depth)*6.0+worldDepthError;
  mask+=w*saturate(2.0-abs(depth-worldDepth)/max(epsilon,1e-30));
  anyValid=true;
 }
 let hole=decodeHoleFill(fill);
 let encodable=hole.y<HOLE_FILL_LENGTH_MAX;
 let fillVelocity=vec2f(cos(hole.x),sin(hole.x))*hole.y;
 if(encodable){
  let own=pixelVelocity(v);
  let ownAngle=atan2(own.y,own.x);let ownLength=length(own);
  let lengthDiff=abs(hole.y-ownLength)-2.0;
  var angleDiff=abs(ownAngle-hole.x);angleDiff=min(angleDiff,TWO_PI-angleDiff);
  let polar=min(saturate(1.0+${wgslF32(1 / 32)}-lengthDiff),saturate(2.0-angleDiff/HOLE_FILL_ANGLE_STEP));
  let cartesian=saturate(1.0+HOLE_FILL_ANGLE_STEP*ownLength-length(fillVelocity-own));
  mask=max(mask,mix(cartesian,polar,saturate(min(hole.y,ownLength)-2.0)));
 }
 return TaaParallax(!offScreen&&mask<0.5,fillVelocity,anyValid&&encodable);
}
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn reprojectHistories(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let mark=textureLoad(marks,p,0);
 let hasOffset=(mark.r&0x80u)!=0u;
 let preliminary=f32(mark.r&0x7fu)/127.0;
 let closestWord=textureLoad(closest,p,0).r;
 let prevZ=abs(bitcast<f32>(closestWord));
 let animated=(closestWord&0x80000000u)!=0u;
 let zError=decodeDepthError(prevZ,mark.g);
 var edge=1.0;
 if(hasOffset){edge=select(neighbourEdge(p),preliminary,preliminary>0.9);}
 let v=dilatedVector(p);
 let screen=screenOfTexel(p);
 let prevScreen=screen-v;
 let offScreen=view.params.x!=0.0||any(prevScreen<vec2f(-1.0))||any(prevScreen>vec2f(1.0));
 // The shading history's last viewport, the last image's render grid, in its allocated textures.
 let uv=ndcToPixel(prevScreen,view.prevRender.xy)*view.analysisGrid.zw;
 let lo=0.5*view.analysisGrid.zw;let hi=(view.prevRender.xy-0.5)*view.analysisGrid.zw;
 var taps=catmullRomTaps(uv,view.analysisGrid.xy,view.analysisGrid.zw);
 var raw=vec4f(0.0);
 for(var k=0;k<5;k++){raw+=textureSampleLevel(prevShading,historySampler,clamp(taps.uv[k],lo,hi),0.0)*taps.weight[k];}
 let random=frameRandom(p,u32(view.jitter.w));
 let shading=ditherUnorm(exposedShading(raw.rgb),random.x,${wgslF32(quantizationError(SHADING_HISTORY_FORMAT))});
 let grid=vec2i(view.analysisGrid.xy);
 let flickerTexel=clampToExtent(vec2i(floor((uv+(random-0.5)*view.analysisGrid.zw)*view.analysisGrid.xy)),grid);
 var flicker=textureLoad(prevFlicker,flickerTexel,0);
 flicker.x=exposedShading(vec3f(flicker.x)).x;
 let parallax=parallaxTest(screen,v,prevZ,zError,offScreen);
 let filled=parallax.canFill&&parallax.disoccluded;
 let bits=select(0u,${REPROJECT_BITS.offScreen}u,offScreen)|select(0u,${REPROJECT_BITS.disoccluded}u,parallax.disoccluded)|select(0u,${REPROJECT_BITS.animated}u,animated)|select(0u,${REPROJECT_BITS.filled}u,filled)|(mark.a&${SHARE_CODE_MASK}u);
 textureStore(shadingOut,p,vec4f(shading,raw.a));
 textureStore(flickerOut,p,flicker);
 let coverage=textureLoad(prevThin,clampToExtent(vec2i(floor(uv*view.analysisGrid.xy)),grid),0).r;
 textureStore(reprojectedOut,p,vec4u(bits|(u32(round(edge*255.0))<<8u)|((coverage&0xffu)<<16u),0u,0u,0u));
 let vector=select(v,screenVelocity(parallax.velocity),filled);
 textureStore(filledOut,p,vec4u(encodeVector(vector),0u,0u,0u));
}`,
    [
      TAA_VIEW_WGSL,
      DEPTH_WGSL,
      CAMERA_MOTION_WGSL,
      REPROJECTION_VECTOR_WGSL,
      HOLE_FILL_WGSL,
      OCCLUDER_WORD_WGSL,
      CATMULL_ROM_TAPS_WGSL,
      COLOR_SPACES_WGSL,
      DITHER_WGSL,
      TILE_CLAMP_WGSL,
      clampToExtent,
      ndcToPixel,
      PI,
      TWO_PI,
    ],
  )
