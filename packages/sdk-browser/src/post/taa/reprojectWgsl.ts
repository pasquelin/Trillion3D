import { MEASURE_BYTE_WGSL } from './flickerLumaWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { PI, TWO_PI } from '../../../../math/src/wgsl/constants.ts'
import { ndcToPixel } from '../../../../math/src/wgsl/projection.ts'
import { clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { TAA_VIEW_WGSL, packedStorageWgsl } from './bindingsWgsl.ts'
import { DEPTH_WGSL } from './depthWgsl.ts'
import {
  CLOSEST_TEXEL_WGSL,
  HOLE_FILL_WGSL,
  OCCLUDER_WORD_WGSL,
  REPROJECTION_VECTOR_WGSL,
  RESTART_MARK,
  TEXEL_TILE,
} from './velocityWgsl.ts'
import { FIELD_FORMAT, FIELD_LAYERS, REPROJECTION_FIELD_WGSL } from './reprojectionFieldWgsl.ts'
import { CATMULL_ROM_TAPS_WGSL } from './historyWgsl.ts'
import { CAMERA_MOTION_WGSL } from './nearestSurfaceWgsl.ts'
import { COLOR_SPACES_WGSL, DITHER_WGSL, quantizationError } from './colorSpaceWgsl.ts'
import { TILE_CLAMP_WGSL } from './tileWgsl.ts'
import { RESURRECTION_WGSL } from './resurrectionWgsl.ts'
import { REPROJECT_HELPERS_TEXT } from './reprojectHelpersWgsl.ts'

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
  field: 11,
  prevThin: 12,
  depth: 13,
  resurrectGuide: 14,
} as const

/** The render-resolution flicker history; the shading history (the colour in the perceptual space
 *  and the reprojection edge it was made at) is kept in the device's `HistoryFormats.guide`. */
export const FLICKER_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** The layers of the reprojected shading histories' texture: the last image's frame's, then, where
 *  the history resurrects, the frame's a pixel may be resurrected from. */
export const GUIDE_LAYERS = { previous: 0, resurrected: 1 } as const
/** The reprojection's word per render texel: the reprojection bits (`REPROJECT_BITS`), the
 *  reprojection edge in the eight bits above them and the last image's thin geometry coverage
 *  history in the eight above that (`thinGeometryWgsl.ts`). */
export const REPROJECTED_FORMAT: GPUTextureFormat = 'r32uint'

/** The reprojection bits: off the last screen, disoccluded by parallax, pixel animation,
 *  disoccluded with the velocity of the occluder it took (hole-filled), for which this pass writes a zero
 *  jacobian and which only a diagnostic view reads (`rejectionWgsl.ts`), restarts: the pixel's material takes its motion vector
 *  for wrong (the level `full` of `RESPONSIVE_LEVELS`), so its history restarts as a disoccluded
 *  one's does and is never resurrected — where this image can resurrect a pixel at all
 *  (`view.resurrection.x`), the bit not set otherwise —, and off the screen of the frame a pixel
 *  may be resurrected from, where this image can resurrect one. */
export const REPROJECT_BITS = {
  offScreen: 1,
  disoccluded: 2,
  animated: 4,
  filled: 8,
  restarts: 16,
  resurrectionOffScreen: 32,
} as const

/**
 * The reprojection's word of render texel `c` as the later passes read it, through their binding
 * `reprojected`, read once (`reprojectedWord`): whether the texel is a pixel animation, whether
 * its history restarts (off the last screen, disoccluded or asked to by its material), whether its
 * material asks it to (it is then never resurrected), and its reprojection edge.
 */
export const REPROJECTED_WORD_WGSL = wgslBlock(
  'REPROJECTED_WORD_WGSL',
  [],
  `
fn reprojectedWord(c:vec2i)->u32{return textureLoad(reprojected,c,0).r;}
fn isAnimated(word:u32)->bool{return (word&${REPROJECT_BITS.animated}u)!=0u;}
fn asksRestart(word:u32)->bool{return (word&${REPROJECT_BITS.restarts}u)!=0u;}
fn isRestarted(word:u32)->bool{return (word&${REPROJECT_BITS.offScreen | REPROJECT_BITS.disoccluded | REPROJECT_BITS.restarts}u)!=0u;}
fn reprojectionEdge(word:u32)->f32{return f32((word>>8u)&0xffu)/255.0;}`,
)

/** The reprojection's bindings, in the guide's format `guideFormat`, and its specialisation switch. */
const reprojectDeclarations = (guideFormat: GPUTextureFormat) =>
  `@group(0) @binding(${REPROJECT_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${REPROJECT_BINDINGS.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${REPROJECT_BINDINGS.closest}) var closest:texture_2d<u32>;
@group(0) @binding(${REPROJECT_BINDINGS.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${REPROJECT_BINDINGS.occluders}) var<storage,read> occluders:array<u32>;
@group(0) @binding(${REPROJECT_BINDINGS.prevShading}) var prevShading:texture_2d<f32>;
@group(0) @binding(${REPROJECT_BINDINGS.historySampler}) var historySampler:sampler;
@group(0) @binding(${REPROJECT_BINDINGS.prevFlicker}) var prevFlicker:texture_2d<f32>;
@group(0) @binding(${REPROJECT_BINDINGS.shading}) var shadingOut:texture_storage_2d_array<${guideFormat},write>;
@group(0) @binding(${REPROJECT_BINDINGS.flicker}) var flickerOut:texture_storage_2d<${FLICKER_FORMAT},write>;
@group(0) @binding(${REPROJECT_BINDINGS.word}) var reprojectedOut:texture_storage_2d<${REPROJECTED_FORMAT},write>;
@group(0) @binding(${REPROJECT_BINDINGS.field}) var fieldOut:texture_storage_2d_array<${FIELD_FORMAT},write>;
@group(0) @binding(${REPROJECT_BINDINGS.prevThin}) var prevThin:texture_2d<f32>;
@group(0) @binding(${REPROJECT_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${REPROJECT_BINDINGS.resurrectGuide}) var resurrectGuide:texture_2d<f32>;
override RESURRECTION:bool=false;`

/** The kernel up to the parallax test: the history read at the last position and the flicker. */
const reprojectKernelHead = (guideFormat: GPUTextureFormat) =>
  `@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
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
 let shading=ditherUnorm(exposedShading(raw.rgb),random.x,${wgslF32(quantizationError(guideFormat))});
 let grid=vec2i(view.analysisGrid.xy);
 let flickerTexel=clampToExtent(vec2i(floor((uv+(random-0.5)*view.analysisGrid.zw)*view.analysisGrid.xy)),grid);
 var flicker=textureLoad(prevFlicker,flickerTexel,0);
 flicker.x=exposedShading(vec3f(flicker.x)).x;
 let parallax=parallaxTest(screen,v,prevZ,zError,offScreen);
 let filled=parallax.canFill&&parallax.disoccluded;`

/** The kernel past the parallax test: the resurrection, the words and the field written. */
const reprojectKernelTail = () =>
  ` // The frame a pixel may be resurrected from: its shading history at the point the texel's closest
 // surface falls at in that frame, in its grid, brought to this image's light.
 var resurrectionOff=false;
 if(RESURRECTION&&view.resurrection.x!=0.0){
  let there=resurrectionPoint(screen,closestDepthOf(p));
  resurrectionOff=any(abs(there.xy)>vec2f(1.0));
  let place=ndcToPixel(there.xy,view.resurrectGrid.xy)*view.analysisGrid.zw;
  let highest=(view.resurrectGrid.xy-0.5)*view.analysisGrid.zw;
  let past=textureSampleLevel(resurrectGuide,historySampler,clamp(place,lo,highest),0.0);
  textureStore(shadingOut,p,${GUIDE_LAYERS.resurrected},vec4f(exposedShadingBy(past.rgb,view.resurrection.y),past.a));
 }
 let bits=select(0u,${REPROJECT_BITS.offScreen}u,offScreen)|select(0u,${REPROJECT_BITS.disoccluded}u,parallax.disoccluded)|select(0u,${REPROJECT_BITS.animated}u,animated)|select(0u,${REPROJECT_BITS.filled}u,filled)|select(0u,${REPROJECT_BITS.restarts}u,(mark.a&${RESTART_MARK}u)!=0u&&view.resurrection.x!=0.0)|select(0u,${REPROJECT_BITS.resurrectionOffScreen}u,resurrectionOff);
 textureStore(shadingOut,p,${GUIDE_LAYERS.previous},vec4f(shading,raw.a));
 textureStore(flickerOut,p,flicker);
 // The coverage history is read only where the detection runs this image (\`view.quality.w\`), the one pass that reads the word's byte; else the byte is 0.
 var coverage=0u;
 if(view.quality.w!=0.0){coverage=measureByte(textureLoad(prevThin,clampToExtent(vec2i(floor(uv*view.analysisGrid.xy)),grid),0).r);}
 textureStore(reprojectedOut,p,vec4u(bits|(u32(round(edge*255.0))<<8u)|((coverage&0xffu)<<16u),0u,0u,0u));
 let vector=select(v,screenVelocity(parallax.velocity),filled);
 textureStore(fieldOut,p,${FIELD_LAYERS.vector},vec4u(encodeVector(vector),0u,0u,0u));
 // A hole-filled texel has no jacobian: the occluder's velocity is all it knows.
 if(filled&&view.fraction.w!=0.0){textureStore(fieldOut,p,${FIELD_LAYERS.jacobian},vec4u(encodeReprojectionJacobian(vec2f(0.0),vec2f(0.0)),0u,0u,0u));}
}`

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
 *   exposure corrected (`view.preExposure.x`), dithered to the bits of `guideFormat`; the flicker measure read at
 *   the nearest texel to the point moved by up to half a texel at random. Off the last screen or on
 *   a cut, the histories are read but marked off screen;
 * - the parallax disocclusion: the closest occluders scattered where they stood (`velocityWgsl.ts`)
 *   read on the 2×2 around the texel's last position, each weighing how close its depth lies to the
 *   texel's own last depth — within three pixel diameters at its depth and the texel's own depth
 *   error —; where the hole-filling velocity of the closest of them matches the texel's own, the
 *   test is passed by that match; disoccluded below a half. A disoccluded texel takes that velocity
 *   as its reprojection, when it is one, so the history update reads the surface the occluder left;
 * - the thin geometry coverage history at the texel the reprojected point falls in, kept in the word
 *   for the thin geometry detection (`thinGeometryWgsl.ts`), read only where it runs this image
 *   (`view.quality.w`: a uniform branch, none taken else, the byte 0);
 * - where the history resurrects (`RESURRECTION`) and this image may (`view.resurrection.x`), the
 *   shading history of the frame a pixel may be resurrected from, read bilinearly at the point the
 *   texel's closest surface falls at in that frame (`resurrectionPoint`), in its grid, brought to this
 *   image's light (`view.resurrection.y`), into the second layer (`GUIDE_LAYERS`); a texel off
 *   that frame's screen reads the edge's texel and carries the bit that says so.
 * A vector load, a marks load and a depth load where the texel took a neighbour's velocity, and 9
 * of each for its edge, 5 bilinear shading history taps, a flicker history load, a coverage history load (where the detection runs) and 4 occluder words per render texel;
 * where it resurrects, a marks load, a depth load and a bilinear read more.
 */
export const reprojectShader = (guideFormat: GPUTextureFormat) =>
  wgslProgram(
    `${reprojectDeclarations(guideFormat)}
${REPROJECT_HELPERS_TEXT}
${reprojectKernelHead(guideFormat)}
${reprojectKernelTail()}`,
    [
      MEASURE_BYTE_WGSL,
      ...packedStorageWgsl(guideFormat),
      TAA_VIEW_WGSL,
      DEPTH_WGSL,
      CAMERA_MOTION_WGSL,
      REPROJECTION_VECTOR_WGSL,
      CLOSEST_TEXEL_WGSL,
      HOLE_FILL_WGSL,
      REPROJECTION_FIELD_WGSL,
      OCCLUDER_WORD_WGSL,
      CATMULL_ROM_TAPS_WGSL,
      COLOR_SPACES_WGSL,
      DITHER_WGSL,
      TILE_CLAMP_WGSL,
      RESURRECTION_WGSL,
      clampToExtent,
      ndcToPixel,
      PI,
      TWO_PI,
    ],
  )
