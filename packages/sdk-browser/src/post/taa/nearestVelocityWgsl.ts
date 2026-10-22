import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ndcToPixel } from '../../../../math/src/wgsl/projection.ts'
import { PAGE_OF_WGSL } from './pageIdWgsl.ts'
import { SAFE_RCP_WGSL } from './historyWgsl.ts'
import { NEAREST_SURFACE_WGSL, VELOCITY_INPUT_BINDINGS } from './nearestSurfaceWgsl.ts'
import {
  CLOSEST_FORMAT,
  HOLE_FILL_WGSL,
  MARKS_FORMAT,
  OCCLUDER_WORD_WGSL,
  SHARE_CODE_SHIFT,
  TEXEL_TILE,
} from './velocityWgsl.ts'

/** The quantisation of a scattered occluder's bilinear weight: a tap of no 63rd scatters none. */
const SCATTER_WEIGHT_STEPS = 63
/** The nearest velocity pass's bindings: its inputs (`VELOCITY_INPUT_BINDINGS`), then its outputs. */
export const VELOCITY_BINDINGS = {
  ...VELOCITY_INPUT_BINDINGS,
  closest: 9,
  marks: 10,
  occluders: 11,
} as const

/** The texel helpers of the nearest velocity beyond its surface: the depth error, whether a texel
 *  moves, and the scatter of the occluders. */
const VELOCITY_HELPERS_WGSL = wgslBlock(
  'VELOCITY_HELPERS_WGSL',
  [NEAREST_SURFACE_WGSL, HOLE_FILL_WGSL, OCCLUDER_WORD_WGSL, SAFE_RCP_WGSL, ndcToPixel],
  `fn depthBilateralError(n:array<f32,9>)->f32{
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
}`,
)

/**
 * The nearest velocity, once per render texel, before the history is reprojected: the nearest
 * surface of the texel (`nearestSurface`), then
 * - the parallax depth error: the depth steps to the four neighbours, each weighed by how far it
 *   continues the surface (`depthBilateralError`);
 * - the reprojection edge, `1.1 − 1.1 · |Δv|₁` of the closest surface's velocity and, where the
 *   texel took a neighbour's, its own, in render pixels, one where it took none;
 * - how far the texel moves for the flicker measure (`isMoving`): its surface point's world motion
 *   past a pixel's diameter at its depth, and the camera's parallax at the texel past half the
 *   limit (`view.rates.x`); a pixel animation (`pageOf`) moves it in full;
 * - the closest occluder scattered where it stood in the last image (`scatterOccluder`): on the
 *   2×2 a bilinear read there weighs, each word keeping the greatest — the closest depth in its
 *   high bits, its hole-filling velocity in its low ones; under an orthographic projection the
 *   depth on 23 bits in both of two words, each carrying half of the velocity.
 * Two reprojections per render texel where it takes a neighbour's velocity.
 */
export const velocityShader = () =>
  wgslProgram(
    `@group(0) @binding(${VELOCITY_BINDINGS.closest}) var closestOut:texture_storage_2d<${CLOSEST_FORMAT},write>;
@group(0) @binding(${VELOCITY_BINDINGS.marks}) var marksOut:texture_storage_2d<${MARKS_FORMAT},write>;
@group(0) @binding(${VELOCITY_BINDINGS.occluders}) var<storage,read_write> occluders:array<atomic<u32>>;
@compute @workgroup_size(${TEXEL_TILE},${TEXEL_TILE})
fn nearestVelocity(@builtin(global_invocation_id) gid:vec3u){
 let p=vec2i(gid.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let surface=nearestSurface(p);
 let nearest=surface.motion;
 let zc=surface.depths[4];
 let tookNeighbour=any(surface.offset!=vec2i(0));
 // The edge is read only where the texel took a neighbour's velocity (the offset bit): there, how
 // far that velocity lies from the texel's own; elsewhere none, and its own is not computed.
 var edge=1.0;
 if(tookNeighbour){
  let own=texelMotion(p,p,zc,surface.id);
  let delta=abs(pixelVelocity(nearest.velocity.xy-own.velocity.xy));
  edge=saturate(1.1-dot(delta,vec2f(1.1)));
 }
 let prevClosestZ=surface.closestZ-nearest.velocity.z;
 let page=pageOf(surface.id);
 let animated=page.animated>0.0;
 let moving=isMoving(p,zc,surface.closestZ,nearest,animated);
 let signedZ=select(prevClosestZ,-prevClosestZ,animated);
 textureStore(closestOut,p,vec4u(bitcast<u32>(signedZ),0u,0u,0u));
 let offsetBit=select(0u,0x80u,tookNeighbour);
 let offsetCode=(u32(surface.offset.x+1)+u32(surface.offset.y+1)*4u)|(page.share<<${SHARE_CODE_SHIFT}u);
 textureStore(marksOut,p,vec4u(u32(round(edge*127.0))|offsetBit,encodeDepthError(prevClosestZ,depthBilateralError(surface.depths)),u32(round(moving*255.0)),offsetCode));
 scatterOccluder(screenOfTexel(p),nearest.velocity.xy,prevClosestZ);
}`,
    [PAGE_OF_WGSL, VELOCITY_HELPERS_WGSL],
  )
