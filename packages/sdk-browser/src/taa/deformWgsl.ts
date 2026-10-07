import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { planeBarycentric } from '../../../math/src/wgsl/barycentric.ts'
import { worldMatrix3 } from '../../../math/src/wgsl/matrix.ts'

/**
 * Per-vertex motion of a deformed surface: where the last frame drew the surface point a
 * pixel shows. The pixel's point, relative to the eye, lies on the triangle its identifier names;
 * its barycentric weights on that triangle, as this frame deforms it, carry the same weights of
 * the triangle as the last frame deformed it (`pagePreviousPosition`). The difference, taken into
 * the world by the placement's linear part, moves the point back before the placement's own
 * motion and the last view project it. The page geometry is read as every pass reads it.
 */
export const TAA_DEFORM_WGSL = wgslBlock(
  'TAA_DEFORM_WGSL',
  [PAGE_GEOMETRY_WGSL, worldMatrix3, planeBarycentric],
  `
/** \`position\`, the homogeneous point of identifier \`id\` relative to the eye, where its surface
 *  stood in the last frame: untouched off a deformed row. */
fn deformedPrevious(id:u32,position:vec4f)->vec4f{
 if(id==0u){return position;}
 let page=pages[(id>>8u)-1u];
 if(page.deformOutput==0u){return position;}
 let h=pageHeaderFor(page,false);let corners=pageTriangle(page,h,id&0xffu);
 let m=worldMatrix3(page.world);
 let t=page.world[3].xyz-view.eye.xyz;
 let c0=pagePosition(page,h,corners.x);let c1=pagePosition(page,h,corners.y);let c2=pagePosition(page,h,corners.z);
 let q=position.xyz/position.w;
 let b=planeBarycentric(q,m*c0+t,m*c1+t,m*c2+t);
 let d0=pagePreviousPosition(page,h,corners.x)-c0;let d1=pagePreviousPosition(page,h,corners.y)-c1;
 let d2=pagePreviousPosition(page,h,corners.z)-c2;
 return vec4f(q+m*(b.x*d0+b.y*d1+b.z*d2),1.0);
}`,
)
