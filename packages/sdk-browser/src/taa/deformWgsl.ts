import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'

/**
 * Per-vertex motion of a deformed surface: where the last frame drew the surface point a
 * pixel shows. The pixel's point, relative to the eye, lies on the triangle its identifier names;
 * its barycentric weights on that triangle, as this frame deforms it, carry the same weights of
 * the triangle as the last frame deformed it (`pagePreviousPosition`). The difference, taken into
 * the world by the placement's linear part, moves the point back before the placement's own
 * motion and the last view project it. The page geometry is read as every pass reads it.
 */
export const TAA_DEFORM_WGSL = `${PAGE_GEOMETRY_WGSL}
/** Barycentric weights of \`q\` on the triangle \`a\`, \`b\`, \`c\`, on its plane. */
fn taaBarycentric(q:vec3f,a:vec3f,b:vec3f,c:vec3f)->vec3f{
 let e0=b-a;let e1=c-a;let e2=q-a;
 let d00=dot(e0,e0);let d01=dot(e0,e1);let d11=dot(e1,e1);let d20=dot(e2,e0);let d21=dot(e2,e1);
 let den=d00*d11-d01*d01;
 if(den==0.0){return vec3f(1.0,0.0,0.0);}
 let v=(d11*d20-d01*d21)/den;let w=(d00*d21-d01*d20)/den;
 return vec3f(1.0-v-w,v,w);
}
/** \`position\`, the homogeneous point of identifier \`id\` relative to the eye, where its surface
 *  stood in the last frame: untouched off a deformed row. */
fn deformedPrevious(id:u32,position:vec4f)->vec4f{
 if(id==0u){return position;}
 let page=pages[(id>>8u)-1u];
 if(page.deformOutput==0u){return position;}
 let h=pageHeaderFor(page,false);let corners=pageTriangle(page,h,id&0xffu);
 let m=mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz);
 let t=page.world[3].xyz-view.eye.xyz;
 let c0=pagePosition(page,h,corners.x);let c1=pagePosition(page,h,corners.y);let c2=pagePosition(page,h,corners.z);
 let q=position.xyz/position.w;
 let b=taaBarycentric(q,m*c0+t,m*c1+t,m*c2+t);
 let d0=pagePreviousPosition(page,h,corners.x)-c0;let d1=pagePreviousPosition(page,h,corners.y)-c1;
 let d2=pagePreviousPosition(page,h,corners.z)-c2;
 return vec4f(q+m*(b.x*d0+b.y*d1+b.z*d2),1.0);
}`
