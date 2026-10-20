import { NO_PAGE_ID } from './pageIdWgsl.ts'
import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { planeBarycentric } from '../../../math/src/wgsl/barycentric.ts'
import { worldMatrix3 } from '../../../math/src/wgsl/matrix.ts'
import { perspectiveDivide } from '../../../math/src/wgsl/projection.ts'
import { visPageIndex, visTriangle } from '../visibility/visWords.ts'

/**
 * Per-vertex motion of a deformed surface: where the last frame drew the surface point a
 * pixel shows. The pixel's point, relative to the eye, lies on the triangle its identifier names;
 * its barycentric weights on that triangle, as this frame deforms it, carry the same weights of
 * the triangle as the last frame deformed it (`pagePreviousPosition`). The difference, taken into
 * the world by the placement's linear part, moves the point back before the placement's own
 * motion and the last view project it. The page geometry is read as every pass reads it.
 */
const TAA_DEFORM_WGSL = wgslBlock(
  'TAA_DEFORM_WGSL',
  [
    PAGE_GEOMETRY_WGSL,
    worldMatrix3,
    planeBarycentric,
    perspectiveDivide,
    visPageIndex,
    visTriangle,
  ],
  `
/** \`position\`, the homogeneous point of identifier \`id\` relative to the eye, where its surface
 *  stood in the last frame: untouched off a deformed row. */
fn deformedPrevious(id:u32,position:vec4f)->vec4f{
 if(${NO_PAGE_ID}){return position;}
 let page=pages[visPageIndex(id)];
 if(page.deformOutput==0u){return position;}
 let h=pageHeaderFor(page,false);let corners=pageTriangle(page,h,visTriangle(id));
 let m=worldMatrix3(page.world);
 let t=page.world[3].xyz-view.eye.xyz;
 let c0=pagePosition(page,h,corners.x);let c1=pagePosition(page,h,corners.y);let c2=pagePosition(page,h,corners.z);
 let q=perspectiveDivide(position);
 let b=planeBarycentric(q,m*c0+t,m*c1+t,m*c2+t);
 let d0=pagePreviousPosition(page,h,corners.x)-c0;let d1=pagePreviousPosition(page,h,corners.y)-c1;
 let d2=pagePreviousPosition(page,h,corners.z)-c2;
 return vec4f(q+m*(b.x*d0+b.y*d1+b.z*d2),1.0);
}`,
)

/**
 * Where the surface point `here` a render texel shows stood in the last frame, relative to this
 * frame's eye (`pointBefore`): a geometry texel's point through its own motion matrix —
 * `previous·current⁻¹`, identity for those that have not moved — after its deformation moved it
 * back; the background, at zero depth (reversed, infinite far plane), is a direction and goes back
 * as it is, which keeps the silhouette stable when the camera turns. `id` is the identifier of the
 * texel, read once for its identity, its motion and its deformation. The nearest velocity pass
 * reprojects it (`velocityWgsl.ts`).
 */
export const TAA_REPROJECT_WGSL = wgslBlock(
  'TAA_REPROJECT_WGSL',
  [TAA_DEFORM_WGSL, visPageIndex],
  `
fn placementOf(id:u32)->u32{return pages[visPageIndex(id)].placement;}
fn pointBefore(here:vec4f,id:u32)->vec4f{
 var position=here;
 // A deformed surface was elsewhere in the last frame: its point moves back first.
 if(view.eye.w!=0.0){position=deformedPrevious(id,position);}
 if(view.params.z!=0.0&&!(${NO_PAGE_ID})){position=motion[placementOf(id)]*position;}
 return position;
}`,
)
