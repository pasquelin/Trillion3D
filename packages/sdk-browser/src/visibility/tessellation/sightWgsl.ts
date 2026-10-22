import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { boxBehindPlane } from '../../../../math/src/wgsl/geometry.ts'
import { PYRAMID_BOX_WGSL } from '../../geometry/dag/shader/occlusionWgsl.ts'
import { OCCLUSION_MAIN, OCCLUSION_POST } from './contract.ts'
import { BOX3 } from './patchWgsl.ts'

/** What the view makes of a patch's box (`patchSight`): none of the image, seen, or hidden by the
 *  pyramid. */
export const SIGHT_GONE = 0,
  SIGHT_SEEN = 1,
  SIGHT_HIDDEN = 2

/** Whether the world's box `box` of a row (in its local space, `world` its placement) lies wholly
 *  outside one plane of the view's frustum, or behind the eye: the corners of the box through the
 *  view and projection, each plane taken alone. */
const boxOutside = wgslFn(
  'boxOutside',
  [BOX3],
  `fn boxOutside(box:Box3,world:mat4x4f)->bool{
 let m=uni.viewProj*world;
 var left=true;var right=true;var below=true;var above=true;var behind=true;
 for(var k=0u;k<8u;k++){
  let corner=select(box.lo,box.hi,vec3<bool>((k&1u)!=0u,(k&2u)!=0u,(k&4u)!=0u));
  let c=m*vec4f(corner,1.0);
  left=left&&c.x<-c.w;right=right&&c.x>c.w;below=below&&c.y<-c.w;above=above&&c.y>c.w;behind=behind&&c.w<=0.0;
 }
 return left||right||below||above||behind;
}`,
)

/**
 * THE SIGHT OF A PATCH: the verdict on its box, `box` in the local space of `world`, under the view,
 * in the order the cut judges a box (`../../geometry/dag/shader/occlusionWgsl.ts`). A box wholly
 * outside the frustum or behind the eye (`boxOutside`), wholly behind the view's clip plane while the
 * cut culls by it (`uni.clipRoute`), or that covers no pixel centre, is gone. Under the pyramid:
 * - the post pass (`OCCLUSION_POST`) tests it against this image's, built from what the main pass
 *   drew, and drops what it hides, unless the box reaches the near plane;
 * - the main pass (`OCCLUSION_MAIN`) tests it against the previous image's, at the previous image's
 *   matrix and size, and hides what it hides — the pass keeps those for the post pass —, unless the
 *   box was off screen or reached the near plane then. The previous pose of a placement is its pose
 *   now: a patch of a moving placement the previous pyramid hides wrongly is tested again by the
 *   post pass against this image's own.
 */
export const PATCH_SIGHT_WGSL = wgslFn(
  'patchSight',
  [PYRAMID_BOX_WGSL, boxBehindPlane, boxOutside],
  `fn patchSight(box:Box3,world:mat4x4f)->u32{
 if(boxOutside(box,world)){return ${SIGHT_GONE}u;}
 if(uni.clipRoute!=0u&&boxBehindPlane(uni.clipPlane*world,box.lo,box.hi)){return ${SIGHT_GONE}u;}
 let c=0.5*(box.lo+box.hi);let e=0.5*(box.hi-box.lo);
 let perspective=uni.perspective>0.0;
 let now=clipBoxOf(c,e,uni.viewProj*world,tu.depthMap,perspective);
 let rect=centreRect(now.lo.xy,now.hi.xy,vec2u(uni.viewport));
 if(!coversCentre(rect)){return ${SIGHT_GONE}u;}
 if(tu.occlusion==${OCCLUSION_POST}u){
  if(!now.crossesNear&&!pyramidShows(rect,now.hi.z)){return ${SIGHT_HIDDEN}u;}
 }
 if(tu.occlusion==${OCCLUSION_MAIN}u){
  let before=clipBoxOf(c,e,tu.prevViewProj*world,tu.prevDepthMap,perspective);
  if(before.inside&&!before.crossesNear&&!pyramidShows(centreRect(before.lo.xy,before.hi.xy,tu.prevSize),before.hi.z)){return ${SIGHT_HIDDEN}u;}
 }
 return ${SIGHT_SEEN}u;
}`,
)
