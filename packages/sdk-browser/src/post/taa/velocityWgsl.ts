import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { TAU } from '../../../../math/src/constants.ts'
import {
  ndcToPixel,
  perspectiveDivide,
  transformHomogeneousPoint,
  uvToNdc,
} from '../../../../math/src/wgsl/projection.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { HISTORY_SHARE_MASK } from '../../visibility/types.ts'
import { visPageIndex } from '../../visibility/visWords.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import { TAA_REPROJECT_WGSL } from './deformWgsl.ts'
import { PAGE_OF_WGSL } from './pageIdWgsl.ts'
import { DEPTH_WGSL } from './depthWgsl.ts'
import { TILE_CLAMP_WGSL } from './tileWgsl.ts'
import { SAFE_RCP_WGSL } from './historyWgsl.ts'

/** The texel tile of a render-resolution pass that reads no neighbourhood network: 8 × 8. */
export const TEXEL_TILE = 8

/** The bits of the hole-filling velocity a closest occluder carries: 5 of angle, 13 of length in
 *  32nds of a pixel. */
const HOLE_FILL_BITS = 18
const HOLE_FILL_LENGTH_BITS = 13
const HOLE_FILL_ANGLE_BITS = HOLE_FILL_BITS - HOLE_FILL_LENGTH_BITS
const HOLE_FILL_LENGTH_STEPS = 32
/** The quantisation of a scattered occluder's bilinear weight: a tap of no 63rd scatters none. */
const SCATTER_WEIGHT_STEPS = 63
/** An orthographic occluder's depth in 23 bits, the velocity's two halves in 9 each. */
const ORTHO_DEPTH_STEPS = 8388607

/**
 * A reprojection vector — a render texel's screen position less the one its surface had in the last
 * image, in device coordinates — in one word: each axis its signed square root, scaled to
 * `(-2, 2)` of the screen and coded in sixteen bits about the middle, so a slow motion keeps fine
 * steps (`encodeVector`, `decodeVector`). `screenOfTexel` is a render texel centre's device
 * position, unjittered; `pixelVelocity` a device vector in render pixels, `y` down.
 */
export const REPROJECTION_VECTOR_WGSL = wgslBlock(
  'REPROJECTION_VECTOR_WGSL',
  [uvToNdc],
  `
fn encodeVector(v:vec2f)->u32{
 let g=sign(v)*sqrt(abs(v))*${wgslF32(2 / Math.SQRT2)};
 let e=g*${wgslF32(0.499 * 0.5)}+${wgslF32(32767 / 65535)};
 let u=vec2u(clamp(e*65535.0+0.5,vec2f(0.0),vec2f(65535.0)));
 return u.x|(u.y<<16u);
}
fn decodeVector(w:u32)->vec2f{
 let e=vec2f(f32(w&0xffffu),f32(w>>16u))*${wgslF32(1 / 65535)};
 let g=e*${wgslF32(1 / (0.499 * 0.5))}-${wgslF32(32767 / 65535 / (0.499 * 0.5))};
 return g*abs(g)*0.5;
}
fn screenOfTexel(p:vec2i)->vec2f{return uvToNdc((vec2f(p)+0.5)*view.render.zw);}
fn pixelVelocity(v:vec2f)->vec2f{return v*vec2f(0.5,-0.5)*view.render.xy;}
fn screenVelocity(v:vec2f)->vec2f{return v*vec2f(2.0,-2.0)*view.render.zw;}`,
)

/**
 * The hole-filling velocity a closest occluder carries in its low bits: its angle on 5 bits and its
 * length in 32nds of a pixel on 13, so a disoccluded texel can take the velocity of what covered it
 * (`reprojectWgsl.ts`); `HOLE_FILL_LENGTH_MAX`, the longest velocity coded.
 */
export const HOLE_FILL_WGSL = wgslBlock(
  'HOLE_FILL_WGSL',
  [PI],
  `
const HOLE_FILL_LENGTH_MAX:f32=${wgslF32(((1 << HOLE_FILL_LENGTH_BITS) - 1.5) / HOLE_FILL_LENGTH_STEPS)};
const HOLE_FILL_ANGLE_STEP:f32=${wgslF32(TAU / (1 << HOLE_FILL_ANGLE_BITS))};
fn encodeHoleFill(v:vec2f)->u32{
 let angle=atan2(v.y,v.x)*${wgslF32((0.5 * (1 << HOLE_FILL_ANGLE_BITS)) / Math.PI)}+${(0.5 * (1 << HOLE_FILL_ANGLE_BITS)).toFixed(1)};
 let a=u32(round(angle))&${(1 << HOLE_FILL_ANGLE_BITS) - 1}u;
 let l=u32(min(ceil(length(v)*${HOLE_FILL_LENGTH_STEPS}.0),${(1 << HOLE_FILL_LENGTH_BITS) - 1}.0));
 return a*${1 << HOLE_FILL_LENGTH_BITS}u+l;
}
/** The angle and the length of a coded velocity. */
fn decodeHoleFill(code:u32)->vec2f{
 let l=f32(code%${1 << HOLE_FILL_LENGTH_BITS}u)*${wgslF32(1 / HOLE_FILL_LENGTH_STEPS)};
 let a=f32((code>>${HOLE_FILL_LENGTH_BITS}u)%${1 << HOLE_FILL_ANGLE_BITS}u)*HOLE_FILL_ANGLE_STEP-PI;
 return vec2f(a,l);
}`,
)

/**
 * The closest occluder words (`scatterOccluder`, `reprojectWgsl.ts`), each keeping the greatest
 * written: under a perspective one word, the closest depth's half float in the high bits over the
 * hole-filling velocity's 18 (`occluderWord`, `occluderDepth`); under an orthographic projection
 * two, the depth on 23 bits in both over 9 bits of the velocity each (`orthoOccluderWords`,
 * `orthoOccluderDepth`, `orthoOccluderFill`).
 */
export const OCCLUDER_WORD_WGSL = wgslBlock(
  'OCCLUDER_WORD_WGSL',
  [],
  `
fn occluderWord(z:f32,code:u32)->u32{return ((pack2x16float(vec2f(z,0.0))&0xffffu)<<${HOLE_FILL_BITS}u)|code;}
fn occluderDepth(word:u32)->f32{return unpack2x16float(word>>${HOLE_FILL_BITS}u).x;}
fn orthoOccluderWords(z:f32,code:u32)->vec2u{
 let d=u32(clamp(round(z*${ORTHO_DEPTH_STEPS}.0),0.0,${ORTHO_DEPTH_STEPS}.0))<<9u;
 return vec2u(d|((code>>9u)&0x1ffu),d|(code&0x1ffu));
}
fn orthoOccluderDepth(word:u32)->f32{return f32(word>>9u)*${wgslF32(1 / ORTHO_DEPTH_STEPS)};}
fn orthoOccluderFill(word:u32,low:u32)->u32{return ((word&0x1ffu)<<9u)|(low&0x1ffu);}`,
)

/** The nearest velocity pass's bindings. */
export const VELOCITY_BINDINGS = {
  view: 0,
  depth: 1,
  ids: 2,
  pages: 3,
  motion: 4,
  indices: 5,
  positions: 6,
  uvs: 7,
  closest: 8,
  marks: 9,
  vectors: 10,
  occluders: 11,
} as const

/** The nearest velocity's targets: each render texel's closest depth in the last image (signed by
 *  its pixel animation), its marks (reprojection edge and offset bit, depth error, moving
 *  share, offset code and history share code), the reprojection vector of the closest surface (`encodeVector`). */
export const CLOSEST_FORMAT: GPUTextureFormat = 'r32uint'
export const MARKS_FORMAT: GPUTextureFormat = 'rgba8uint'
/** The shift of the four bits holding the code of the most of its history the texel's surface
 *  keeps (`pageOf`, `HISTORY_SHARE_SHIFT`): above the offset code in the marks' fourth channel,
 *  which the reprojection writes into the same bits of its word, which the shading rejection
 *  writes into the same bits of its own (`resolveWgsl.ts`). */
export const SHARE_CODE_SHIFT = 4
/** Those four bits, in place. */
export const SHARE_CODE_MASK = HISTORY_SHARE_MASK << SHARE_CODE_SHIFT
export const VECTOR_FORMAT: GPUTextureFormat = 'r32uint'

/**
 * The nearest velocity, once per render texel, before the history is reprojected:
 * - the 3×3's depths, and the closest of the two horizontal and the two vertical neighbours that
 *   stand out of the texel — their mean nearer than the texel by more than a quarter of their own
 *   difference and than the texel's pixel depth error (`pixelDeviceZError`) —: on a flat surface the
 *   texel keeps its own velocity, on a depth edge it takes the foreground's. The depth and its
 *   offset are packed in one word, the offset in the low four bits, so one maximum picks both;
 * - the parallax depth error: the depth steps to the four neighbours, each weighed by how far it
 *   continues the surface (`depthBilateralError`);
 * - the texel's own velocity and the closest surface's, each the motion of a surface point: a point that
 *   moved by itself — a placement whose motion is not the identity, a deformed geometry
 *   (`drawsMotion`) — at its own texel, any other at this texel's centre and the closest depth,
 *   so the camera's motion is the closest surface's; the reprojection edge, `1.1 − 1.1 · |Δv|₁` of the
 *   two in render pixels;
 * - how far the texel moves for the flicker measure (`isMoving`): its surface point's world motion
 *   past a pixel's diameter at its depth, and the camera's parallax at the texel past half the
 *   limit (`view.rates.x`); a pixel animation (`pageOf`) moves it in full;
 * - the closest occluder scattered where it stood in the last image (`scatterOccluder`): on the
 *   2×2 a bilinear read there weighs, each word keeping the greatest — the closest depth in its
 *   high bits, its hole-filling velocity in its low ones; under an orthographic projection the
 *   depth on 23 bits in both of two words, each carrying half of the velocity.
 * 9 depth loads, one identifier load — two where the texel takes a neighbour's velocity — and two
 * reprojections per render texel.
 */
export const velocityShader = () =>
  wgslProgram(
    `@group(0) @binding(${VELOCITY_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${VELOCITY_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${VELOCITY_BINDINGS.ids}) var ids:texture_2d<u32>;
@group(0) @binding(${VELOCITY_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${VELOCITY_BINDINGS.motion}) var<storage,read> motion:array<mat4x4f>;
@group(0) @binding(${VELOCITY_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${VELOCITY_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${VELOCITY_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;
@group(0) @binding(${VELOCITY_BINDINGS.closest}) var closestOut:texture_storage_2d<${CLOSEST_FORMAT},write>;
@group(0) @binding(${VELOCITY_BINDINGS.marks}) var marksOut:texture_storage_2d<${MARKS_FORMAT},write>;
@group(0) @binding(${VELOCITY_BINDINGS.vectors}) var vectorOut:texture_storage_2d<${VECTOR_FORMAT},write>;
@group(0) @binding(${VELOCITY_BINDINGS.occluders}) var<storage,read_write> occluders:array<atomic<u32>>;
fn packDepthOffset(o:vec2i,z:f32)->u32{return ((bitcast<u32>(z)<<2u)&~0xfu)|u32(1+o.x)|(u32(1+o.y)<<2u);}
fn depthBilateralError(n:array<f32,9>)->f32{
 var t=n;
 let c=t[4];let e=t[5];let w=t[3];let s=t[7];let nn=t[1];
 let variationEW=abs(c-(e+w)*0.5);let variationSN=abs(c-(s+nn)*0.5);
 let dE=abs(e-c);let dW=abs(w-c);let dS=abs(s-c);let dN=abs(nn-c);
 let minE=min(abs(e-w),min(dE,dW));let minS=min(abs(s-nn),min(dS,dN));
 let pixelError=pixelDeviceZError(c);
 let finalE=max(min(max(minE,pixelError),max(minS,8.0*pixelError)),1e-30);
 let finalS=max(min(max(minS,pixelError),max(minE,8.0*pixelError)),1e-30);
 var wE=saturate(1.5-min(dE,variationEW)/finalE);var wW=saturate(1.5-min(dW,variationEW)/finalE);
 var wS=saturate(1.5-min(dS,variationSN)/finalS);var wN=saturate(1.5-min(dN,variationSN)/finalS);
 let tEW=wE+wW;let tSN=wS+wN;
 let iEW=safeRcp(tEW);let iSN=safeRcp(tSN);
 wE*=iEW;wW*=iEW;wS*=iSN;wN*=iSN;
 return max(dE*wE+dW*wW,dS*wS+dN*wN);
}
fn drawsMotion(id:u32)->bool{
 if(id==0u){return false;}
 let page=pages[visPageIndex(id)];
 if(view.eye.w!=0.0&&page.deformOutput!=0u){return true;}
 if(view.params.z==0.0){return false;}
 let m=motion[page.placement];
 return any(m[0]!=vec4f(1.0,0.0,0.0,0.0))||any(m[1]!=vec4f(0.0,1.0,0.0,0.0))||any(m[2]!=vec4f(0.0,0.0,1.0,0.0))||any(m[3]!=vec4f(0.0,0.0,0.0,1.0));
}
struct TaaMotion{velocity:vec3f,shift:f32}
fn surfaceMotion(screen:vec2f,z:f32,id:u32)->TaaMotion{
 let here=transformHomogeneousPoint(view.invViewProj,vec3f(screen,z));
 let before=pointBefore(here,id);
 var shift=0.0;
 if(here.w!=0.0&&before.w!=0.0){shift=length(perspectiveDivide(before)-perspectiveDivide(here));}
 let prev=view.prevViewProj*before;
 // Behind the last view: the last image held no trace of it, off its screen.
 if(prev.w<=0.0){return TaaMotion(vec3f(screen+vec2f(4.0),0.0),shift);}
 let p=perspectiveDivide(prev);
 return TaaMotion(vec3f(screen-p.xy,z-p.z),shift);
}
fn texelMotion(p:vec2i,q:vec2i,z:f32,id:u32)->TaaMotion{
 if(drawsMotion(id)){return surfaceMotion(screenOfTexel(q),z,id);}
 return surfaceMotion(screenOfTexel(p),z,id);
}
fn isMoving(p:vec2i,zc:f32,closestZ:f32,nearest:TaaMotion,animated:bool)->f32{
 if(animated){return 1.0;}
 let radius=pixelRadiusAt(sceneDepthOf(closestZ))*2.0;
 var moving=saturate(nearest.shift/max(radius,1e-30)-1.0);
 let here=transformHomogeneousPoint(view.invViewProj,vec3f(screenOfTexel(p),zc));
 let seen=view.prevViewProj*here;
 let turned=seen+view.parallax*here.w;
 if(seen.w>0.0&&turned.w>0.0){
  let parallax=0.5*length((perspectiveDivide(turned).xy-perspectiveDivide(seen).xy)*view.render.xy);
  moving=max(moving,saturate(parallax*view.rates.x-0.5));
 }
 return moving;
}
fn scatterOccluder(screen:vec2f,v:vec2f,prevZ:f32){
 let size=vec2i(view.render.xy);
 let prevPixel=ndcToPixel(screen-v,view.render.xy);
 if(any(prevPixel<=vec2f(-0.5))||any(prevPixel>=view.render.xy+0.5)){return;}
 let code=encodeHoleFill(pixelVelocity(v));
 let r=prevPixel-0.5;let base=vec2i(floor(r));let f=r-vec2f(base);
 let ortho=view.radius.w!=0.0;
 var words=vec2u(occluderWord(prevZ,code),0u);
 if(ortho){words=orthoOccluderWords(prevZ,code);}
 let word=words.x;let low=words.y;
 let count=u32(size.x)*u32(size.y);
 for(var j=0u;j<4u;j++){
  let d=vec2i(i32(j&1u),i32(j>>1u));let at=base+d;
  let w=mix(1.0-f.x,f.x,f32(d.x))*mix(1.0-f.y,f.y,f32(d.y));
  if(round(w*${SCATTER_WEIGHT_STEPS}.0)<=0.0||any(at<vec2i(0))||any(at>=size)){continue;}
  let index=u32(at.y)*u32(size.x)+u32(at.x);
  let before=atomicMax(&occluders[index],word);
  if(ortho&&before<word){atomicMax(&occluders[count+index],low);}
 }
}
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn nearestVelocity(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 var z:array<f32,9>;
 for(var k=0;k<9;k++){z[k]=textureLoad(depth,clampTexel(p+vec2i(k%3-1,k/3-1)),0);}
 let zc=z[4];
 let zError=pixelDeviceZError(zc);
 var packed=packDepthOffset(vec2i(0),zc);
 for(var axis=0;axis<2;axis++){
  let pair=select(vec2i(0,1),vec2i(1,0),axis==0);
  let z0=z[4+pair.x+3*pair.y];let z1=z[4-pair.x-3*pair.y];
  if((z0+z1)*0.5-zc>max(abs(z1-z0)*0.25,zError)){
   packed=max(packed,packDepthOffset(pair,z0));
   packed=max(packed,packDepthOffset(-pair,z1));
  }
 }
 let closestZ=bitcast<f32>((packed&~0xfu)>>2u);
 let offset=vec2i(i32(packed&3u),i32((packed>>2u)&3u))-vec2i(1);
 let id=textureLoad(ids,p,0).r;
 let own=texelMotion(p,p,zc,id);
 // The closest neighbour's identifier, a second load only where the texel took a neighbour's.
 let q=clampTexel(p+offset);
 var nearId=id;
 if(any(q!=p)){nearId=textureLoad(ids,q,0).r;}
 let nearest=texelMotion(p,q,closestZ,nearId);
 let delta=abs(pixelVelocity(nearest.velocity.xy-own.velocity.xy));
 let edge=saturate(1.1-dot(delta,vec2f(1.1)));
 let prevClosestZ=closestZ-nearest.velocity.z;
 let page=pageOf(id);
 let animated=page.animated>0.0;
 let moving=isMoving(p,zc,closestZ,nearest,animated);
 let signedZ=select(prevClosestZ,-prevClosestZ,animated);
 textureStore(closestOut,p,vec4u(bitcast<u32>(signedZ),0u,0u,0u));
 let offsetBit=select(0u,0x80u,any(offset!=vec2i(0)));
 let offsetCode=(u32(offset.x+1)+u32(offset.y+1)*4u)|(page.share<<${SHARE_CODE_SHIFT}u);
 textureStore(marksOut,p,vec4u(u32(round(edge*127.0))|offsetBit,encodeDepthError(prevClosestZ,depthBilateralError(z)),u32(round(moving*255.0)),offsetCode));
 textureStore(vectorOut,p,vec4u(encodeVector(nearest.velocity.xy),0u,0u,0u));
 scatterOccluder(screenOfTexel(p),nearest.velocity.xy,prevClosestZ);
}`,
    [
      PAGE_INFO_STRUCT_WGSL,
      TAA_VIEW_WGSL,
      TAA_REPROJECT_WGSL,
      PAGE_OF_WGSL,
      DEPTH_WGSL,
      REPROJECTION_VECTOR_WGSL,
      HOLE_FILL_WGSL,
      OCCLUDER_WORD_WGSL,
      TILE_CLAMP_WGSL,
      SAFE_RCP_WGSL,
      visPageIndex,
      ndcToPixel,
      perspectiveDivide,
      transformHomogeneousPoint,
    ],
  )
