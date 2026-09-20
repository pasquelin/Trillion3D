import { DEPTH_GROW, ERR_K, INPUT_K, SCREEN_SLACK_K, wgslFloat } from './gpuPartitionMargins.ts';
import { CORNER_VALUES, FLAG_CLIP } from './gpuPartitionContract.ts';

const K = wgslFloat(ERR_K),
  IN = wgslFloat(INPUT_K),
  SLACK = wgslFloat(SCREEN_SLACK_K),
  GROW = wgslFloat(DEPTH_GROW);

/**
 * Uniform that ALL projection kernels share, byte for byte: the partition writes it once per frame
 * (`gpuPartitionUniform.ts`) and the transparent occlusion test reads the SAME buffer. Two boxes
 * of the same frame therefore enter the same arithmetic, with the same anchor, the same matrices
 * and the same mip table — no conservative rule can diverge.
 */
export const PARTITION_UNI_WGSL = `struct Uni{
 view:mat4x4f,
 viewProj:mat4x4f,
 anchorHigh:vec3f,near:f32,
 anchorLow:vec3f,pad1:f32,
 rows:u32,width:u32,height:u32,levels:u32,
 layerTop:u32,hasRest:u32,viewMoved:u32,forgetFrom:u32,
 forgetEnd:u32,pad2:u32,pad3:u32,pad4:u32,
 levelOffset:array<vec4u,4>,
 levelWidth:array<vec4u,4>,
}
`;

/**
 * Projection of a world box into a screen rectangle and a depth bound, done by the GPU in single
 * precision, **conservative by construction**.
 *
 * The CPU projected the eight world corners in double precision. Here the same arithmetic runs in
 * `f32`, so each dot product carries rounding error. It is not assumed: it is BOUNDED, term by
 * term, by the sum of absolute values of the four products that make that dot product, plus the
 * share of input rounding (`gpuPartitionMargins.ts` carries both proofs). Corners enter RELATIVE
 * to an anchor — the camera pose —, each carried by two single-precision values, and the received
 * matrices are already composed with that translation: otherwise the bound, which does not know
 * that terms of an urban model cancel, would yield rectangles of hundreds of texels and the
 * occlusion test would decide nothing.
 *
 * From that bound follow the three rules:
 *  1. each corner widens its normalised point by its own slack before entering min and max, then
 *     the screen mapping subtracts or adds the screen margin before `floor` and `ceil`: the
 *     returned rectangle therefore CONTAINS the one double precision computed;
 *  2. a box that touches or crosses the near plane — or whose denominator is not surely positive —
 *     carries the clip flag, and a box that carries it is never rejected;
 *  3. nearest depth RISES by each corner's slack, then by two integer ulps before the layer bias:
 *     engine depth being reversed, it is RAISING it that makes rejection safe, exactly as
 *     `hizNearestBound` guarantees in double precision.
 */
export const BOX_PROJECT_WGSL = `
/** What a projected box returns: its unclipped rectangle, its depth bound, and the clip flag
 *  that forbids any rejection. */
struct BoxProj{rect:vec4i,nearest:f32,clips:u32,}
/**
 * A four-term dot product on an anchored point, and enough to bound its error: the value, the
 * sum of absolute values of the terms, and the share of input rounding —
 * \`Σ|m_i| · 3u|d_i|\`, where \`d\` is the corner's offset from the anchor.
 */
fn dot4(a0:f32,a1:f32,a2:f32,a3:f32,d:vec3f,mag:vec3f)->vec3f{
 let p=vec3f(a0*d.x,a1*d.y,a2*d.z);
 return vec3f(
  p.x+p.y+p.z+a3,
  abs(p.x)+abs(p.y)+abs(p.z)+abs(a3),
  abs(a0)*mag.x+abs(a1)*mag.y+abs(a2)*mag.z);
}
/** Upper slack of a dot product: compute rounding and input rounding together. */
fn slackOf(term:vec3f)->f32{return ${K}*term.y+${IN}*term.z;}
/** Upper slack of a quotient whose numerator and denominator each carry their own. */
fn quotientSlack(value:f32,num:vec3f,den:vec3f)->f32{
 return (slackOf(num)+abs(value)*slackOf(den))/den.x+${K}*abs(value);
}
/** Coplanar layer bias on the bits of a depth: mirror of \`biasedDepthBits\`.
 *  Reversed depth: moving closer to the eye is ADDING units, capped at the bits of 1. */
fn biasedDepth(value:f32,layer:u32)->f32{
 if(layer==0u){return value;}
 let units=min(layer,15u)*16u;
 return bitcast<f32>(min(0x3f800000u,bitcast<u32>(value)+units));
}
fn projectBox(slot:u32,layer:u32)->BoxProj{
 var lowX=1.0e30;var highX=-1.0e30;var lowY=1.0e30;var highY=-1.0e30;
 // Reversed depth: the NEAREST corner is the one whose depth is the LARGEST.
 var nearestZ=-1.0e30;
 var clips=false;
 let m=uni.viewProj;let v=uni.view;
 for(var k=0u;k<8u;k++){
  let at=slot*${CORNER_VALUES}u+k*6u;
  // Corner in two words, relative to the anchor also in two words: world magnitude survives
  // none of these subtractions, and the input bound now depends only on the offset.
  let high=vec3f(corners[at],corners[at+1u],corners[at+2u]);
  let low=vec3f(corners[at+3u],corners[at+4u],corners[at+5u]);
  let d=(high-uni.anchorHigh)+(low-uni.anchorLow);
  let mag=abs(d);
  let vz=dot4(v[0][2],v[1][2],v[2][2],v[3][2],d,mag);
  let vd=dot4(v[0][3],v[1][3],v[2][3],v[3][3],d,mag);
  // A view denominator that is not surely positive makes view depth undecidable: the box
  // goes to clip, where nothing rejects it.
  if(!(vd.x>slackOf(vd))){clips=true;break;}
  let depth=-(vz.x/vd.x);
  if(depth-quotientSlack(depth,vz,vd)<=uni.near){clips=true;break;}
  let cw=dot4(m[0][3],m[1][3],m[2][3],m[3][3],d,mag);
  if(!(cw.x>slackOf(cw))||!(abs(cw.x)<3.0e38)){clips=true;break;}
  let cx=dot4(m[0][0],m[1][0],m[2][0],m[3][0],d,mag);
  let cy=dot4(m[0][1],m[1][1],m[2][1],m[3][1],d,mag);
  let cz=dot4(m[0][2],m[1][2],m[2][2],m[3][2],d,mag);
  let nx=cx.x/cw.x;let ny=cy.x/cw.x;let nz=cz.x/cw.x;
  lowX=min(lowX,nx-quotientSlack(nx,cx,cw));highX=max(highX,nx+quotientSlack(nx,cx,cw));
  lowY=min(lowY,ny-quotientSlack(ny,cy,cw));highY=max(highY,ny+quotientSlack(ny,cy,cw));
  nearestZ=max(nearestZ,nz+quotientSlack(nz,cz,cw));
 }
 if(clips){return BoxProj(vec4i(0,0,0,0),0.0,${FLAG_CLIP}u);}
 let wF=f32(uni.width);let hF=f32(uni.height);
 let slack=${SLACK}*max(wF,hF)+1.0e-4;
 let rect=vec4i(
  i32(floor((lowX*0.5+0.5)*wF-slack)),
  i32(floor((1.0-(highY*0.5+0.5))*hF-slack)),
  i32(ceil((highX*0.5+0.5)*wF+slack)),
  i32(ceil((1.0-(lowY*0.5+0.5))*hF+slack)));
 var nearest=nearestZ;
 if(nearest>0.0){nearest=biasedDepth(nearest*${GROW},layer);}
 return BoxProj(rect,nearest,0u);
}
`;
