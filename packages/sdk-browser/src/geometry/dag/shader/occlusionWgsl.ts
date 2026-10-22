import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { transformHalfExtent } from '../../../../../math/src/wgsl/geometry.ts'
import { HIZ_FOOTPRINT_WGSL } from '../../../visibility/hiz/gpu/footprintWgsl.ts'
import { DAG_INF } from './infDecl.ts'

/** The group of the cut's occlusion, and its bindings: the pyramid and its levels
 *  (`../occlusion.ts`), past the rows' closure's own bindings of that group, which the same program
 *  declares (`../../rows/rowClosureWgsl.ts`). */
export const OCCLUSION_GROUP = 1
export const OCCLUSION_BINDING = { pyramid: 4, levels: 5 } as const

/** The cut's uniform `occlusion` word: the two-pass occlusion runs (`TWO_PASS`) — the option asks
 *  it, and the previous image's pyramid stands for this view, its matrices in the block. Without it
 *  the cut runs one pass and no pyramid hides a box; the pixel centres still cull. */
export const OCCLUSION_TWO_PASS = 1

/** True when `uniforms` run the occlusion in two passes: the main view's cut, and a view's aside. */
export const twoPassOf = (uniforms: { readonly occlusion?: number }) =>
  ((uniforms.occlusion ?? 0) & OCCLUSION_TWO_PASS) !== 0

/** What the cut runs (`cutPass`, a word of `work`): the main pass, tested against the previous
 *  image's pyramid, then the post pass, against the pyramid of what the main pass drew. */
const CUT_MAIN = 0,
  CUT_POST = 1

/** A box's verdict: covers no pixel centre or hidden for good, drawn on, or hidden by the previous
 *  image's pyramid alone — tested again in the post pass. */
const BOX_CULLED = 0,
  BOX_SEEN = 1,
  BOX_OCCLUDED = 2

/**
 * What judging a box against a Hi-Z pyramid needs of neither the cut's views nor its poses: the box
 * in clip space (`clipBoxOf`, the projection's weight given), the pixel centres its rectangle covers
 * (`centreRect`, `coversCentre`), and the pyramid's verdict on a rectangle at a depth
 * (`footprintLevel`, `pyramidShows`). The host declares the pyramid and its levels uniform
 * (`hizPyramid`, `hizLevels`): the cut's boxes (`DAG_OCCLUSION_WGSL`) and the tessellation's patches
 * (`../../../visibility/tessellation/splitWgsl.ts`) read them through the one test.
 */
export const PYRAMID_BOX_WGSL = wgslBlock(
  'PYRAMID_BOX_WGSL',
  [HIZ_FOOTPRINT_WGSL, transformHalfExtent, DAG_INF],
  `/** A box in clip space: its normalized rectangle and depths (\`lo\`, \`hi\`; reversed depth, the
 *  nearest the largest), whether it reaches the near plane, and whether it lies between the near and
 *  the far planes. */
struct ClipBox{lo:vec3f,hi:vec3f,crossesNear:bool,inside:bool,}
/** The box of centre \`c\` and half extent \`e\` under \`m\`, local to clip, the projection's depth
 *  \`clip.z = depth.x * w + depth.y\` along its clip weight \`w\`: its eight corners' rectangle and
 *  the depths at their nearest and farthest weights. Orthographic: the centre and its extent mapped
 *  whole, the weight one. A box across the eye's plane covers the whole screen. */
fn clipBoxOf(c:vec3f,e:vec3f,m:mat4x4f,depth:vec2f,perspective:bool)->ClipBox{
 if(!perspective){
  let centre=(m*vec4f(c,1.0)).xyz;let d=transformHalfExtent(m,e);
  let lo=centre-d;let hi=centre+d;
  return ClipBox(lo,hi,hi.z>1.0,hi.z>0.0&&lo.z<1.0);
 }
 let dx=(2.0*e.x)*m[0];let dy=(2.0*e.y)*m[1];let dz=(2.0*e.z)*m[2];
 let p000=m*vec4f(c-e,1.0);let p100=p000+dz;let p001=p000+dx;let p101=p100+dx;
 let p011=p001+dy;let p111=p101+dy;let p010=p011-dx;let p110=p111-dx;
 var corners=array<vec4f,8>(p000,p100,p001,p101,p011,p111,p010,p110);
 var minW=INF;var maxW=-INF;var lo=vec2f(1.0);var hi=vec2f(-1.0);
 for(var k=0u;k<8u;k++){
  let p=corners[k];
  minW=min(minW,p.w);maxW=max(maxW,p.w);
  let s=p.xy/p.w;lo=min(lo,s);hi=max(hi,s);
 }
 let farZ=maxW*depth.x+depth.y;let nearZ=minW*depth.x+depth.y;
 var box=ClipBox(vec3f(lo,farZ/maxW),vec3f(hi,nearZ/minW),minW<=nearZ,maxW>farZ&&0.0<nearZ);
 if(minW<=0.0&&maxW>0.0){box.lo=vec3f(-1.0);box.hi=vec3f(1.0);}
 return box;
}
/** The pixels whose centres a normalized rectangle covers in a view of \`size\`, inclusive, clipped
 *  to the view: empty when \`xy\` passes \`zw\`. */
fn centreRect(lo:vec2f,hi:vec2f,size:vec2u)->vec4i{
 let t=saturate(vec4f(lo,hi)*vec4f(0.5,-0.5,0.5,-0.5)+vec4f(0.5));
 let s=vec2f(size);
 let p=vec4i(vec4f(t.x,t.w,t.z,t.y)*vec4f(s,s)+vec4f(0.5,0.5,-0.5,-0.5));
 return vec4i(max(p.xy,vec2i(0)),min(p.zw,vec2i(size)-vec2i(1)));
}
fn coversCentre(r:vec4i)->bool{return all(r.zw>=r.xy);}
`,
)

/**
 * THE TWO-PASS OCCLUSION OF THE CUT.
 *
 * Every box the cut keeps past its frustum and its level of detail — a cell of the placement tree,
 * a placement's root, a node, a cluster — is projected to the screen and judged here:
 *
 * - its projected rectangle must cover a pixel centre, under this image's render matrix, the one the
 *   raster draws with — jitter included: a box that covers none draws nothing (`coversCentre`);
 * - in the MAIN pass, a box the previous image's pyramid hides — at the pose the previous image drew
 *   it at, projected with that image's matrix in that image's pixels, never when it reaches the near
 *   plane — is held for the post pass (`BOX_OCCLUDED`): its subtree is not walked, its pages not
 *   asked for, its cluster not drawn;
 * - in the POST pass, run once the main pass's clusters are drawn and the pyramid rebuilt from them
 *   (`../../../visibility/passes/passes.ts`), the boxes held are judged again against that pyramid,
 *   and so is every box the post pass's own descent keeps: hidden there, a box is gone.
 *
 * The pyramid's farthest culling layer is read (`hizCullFarthest`): its level `k + 1` is the
 * half-resolution level `k` the test is written for, a texel the farthest depth — reversed, the
 * smallest — of the pixels under it. The rectangle is clipped to the view, shifted to that level, and
 * the level is the first where it spans at most four texels a side (`footprintLevel`): the sixteen
 * texels' minimum against the box's nearest depth.
 * A level past the pyramid's last hides nothing. The levels uniform bound is the one the pyramid was
 * built with (`../../../frame/render/cutPyramid.ts`): the previous image's in the main pass, at the
 * size it drew at (`prevSize`), this image's in the post pass.
 *
 * The view's sizes, matrices and depth maps are the cut's uniform's (`../viewLayout.ts`): `viewProj`
 * and `prevViewProj` map the render frame — the eye at zero — to clip space; the previous one is the
 * previous image's matrix composed at THIS image's eye, so a pose at this eye serves both. A box is
 * tested at its placement's pose now (`preparedPose`) against this image's matrix, and at the pose
 * the previous image drew (`placedBefore`, `../previousPoses.ts`) against the previous image's; a
 * cell of the placement tree is a world box, in the render frame now and before.
 */
export const DAG_OCCLUSION_WGSL = wgslBlock(
  'DAG_OCCLUSION_WGSL',
  [PYRAMID_BOX_WGSL, NO_INDEX],
  `@group(${OCCLUSION_GROUP}) @binding(${OCCLUSION_BINDING.pyramid}) var hizPyramid:texture_2d_array<u32>;
@group(${OCCLUSION_GROUP}) @binding(${OCCLUSION_BINDING.levels}) var<uniform> hizLevels:HizLevels;
${wgslConsts({ OCCLUSION_TWO_PASS, CUT_MAIN, CUT_POST, BOX_CULLED, BOX_SEEN, BOX_OCCLUDED })}
/** \`clipBoxOf\` under the cut's view: its projection's weight. */
fn clipBox(c:vec3f,e:vec3f,m:mat4x4f,depth:vec2f)->ClipBox{return clipBoxOf(c,e,m,depth,views[0u].perspective>0.0);}
/** The cut's pass, which the main pass's prepare and the post pass's open write (\`dagPrepare\`,
 *  \`dagPostPrepare\`). */
fn cutPass()->u32{return atomicLoad(&work[passWord()]);}
/** The render frame's own pose: a cell of the placement tree is a world box, already there. */
const RENDER_FRAME=mat4x4f(1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0);
/** The pose at the eye of the space a box of placement \`w\` lies in — the render frame for
 *  \`NO_INDEX\`, a cell of the tree —: now, and as the previous image drew it. */
fn poseNow(w:u32)->mat4x4f{if(w==NO_INDEX){return RENDER_FRAME;}return preparedPose(w);}
fn poseBefore(w:u32)->mat4x4f{if(w==NO_INDEX){return RENDER_FRAME;}return placedBefore(w);}
/** The verdict on the box \`lo\`–\`hi\` of placement \`w\` (\`NO_INDEX\`, a box of the render frame),
 *  grown by the deformation reach, once it passed the frustum: at its pose now under this image's
 *  matrix, at its pose before under the previous image's (\`poseNow\`, \`poseBefore\`). */
fn boxSight(lo:vec3f,hi:vec3f,w:u32)->u32{
 let c=0.5*(lo+hi);let e=0.5*(hi-lo)+vec3f(deformReach);
 let size=views[0u].viewSize;
 let now=clipBox(c,e,views[0u].viewProj*poseNow(w),views[0u].depthMap);
 let rect=centreRect(now.lo.xy,now.hi.xy,size);
 if(!coversCentre(rect)){return BOX_CULLED;}
 let mode=views[0u].occlusion;
 if((mode&OCCLUSION_TWO_PASS)==0u){return BOX_SEEN;}
 if(cutPass()==CUT_POST){
  if(!now.crossesNear&&!pyramidShows(rect,now.hi.z)){return BOX_CULLED;}
  return BOX_SEEN;
 }
 let before=clipBox(c,e,views[0u].prevViewProj*poseBefore(w),views[0u].prevDepthMap);
 if(!before.inside||before.crossesNear){return BOX_SEEN;}
 if(pyramidShows(centreRect(before.lo.xy,before.hi.xy,views[0u].prevSize),before.hi.z)){return BOX_SEEN;}
 return BOX_OCCLUDED;
}
`,
)
