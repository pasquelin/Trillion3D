import { SHADE_SUN_WGSL } from './request.ts';

/**
 * How the surface resolve places a pixel on its triangle, shared by the resolve (`shadeWgsl.ts`)
 * and the shadow receiver offset its readers recompute (`receiverOffsetWgsl.ts`, #1410): one text,
 * so the offset follows the very point and normals the resolve shaded.
 */

/** The surface resolve's uniform: its camera, viewport and page count, the sun. */
export const SHADE_UNI_WGSL = `${SHADE_SUN_WGSL}
struct ShadeUni{viewProj:mat4x4f,viewport:vec2f,pixelRatio:f32,mipBias:f32,pageCount:u32,mode:u32,feedback:u32,pixelScale:f32,depthRamp:vec4f,sun:ShadeSun,}`;

/** A clip position on the resolve's framebuffer: pixels, then the depth. */
export const FRAMEBUFFER_WGSL = `fn framebuffer(clip:vec4f)->vec3f{
 let ndc=clip.xyz/clip.w;
 return vec3f((ndc.x*0.5+0.5)*uni.viewport.x,(-ndc.y*0.5+0.5)*uni.viewport.y,ndc.z);
}`;

/** The perspective-correct barycentrics of `p` in the screen triangle `s0..s2` of clip corners
 *  `c0..c2` and signed area `area`; a fixed third each on a degenerate triangle. */
export const PIXEL_BARY_WGSL = `fn pixelBary(s0:vec3f,s1:vec3f,s2:vec3f,c0:vec4f,c1:vec4f,c2:vec4f,p:vec2f,area:f32)->vec3f{
 if(area==0.0){return vec3f(0.333,0.333,0.334);}
 let bw=baryWeights(s0.xy,s1.xy,s2.xy,p,area);let a0=bw.x;let a1=bw.y;let a2=bw.z;
 let iw0=1.0/c0.w;let iw1=1.0/c1.w;let iw2=1.0/c2.w;
 let p0w=a0*iw0;let p1w=a1*iw1;let p2w=a2*iw2;let sum=p0w+p1w+p2w;
 return select(vec3f(a0,a1,a2),vec3f(p0w,p1w,p2w)/sum,sum!=0.0);
}`;

/**
 * The triangle's three vertex normals in the world, one per column, turned to `side`. The three
 * undergo the SAME matrix: normalisation, determinant and adjugate are computed once for the
 * pixel, and each normal only keeps the 3×3 product. uniteOuZero returns normalize on any non-zero
 * vector; it only differs where normalize would yield NaN — collapsed face, degenerate triangle.
 * On a rank-2 pose, invTranspose3Apply returns the transformed FACE normal: the three vertex
 * normals fall on the same direction, and interpolation keeps it.
 */
export const VERTEX_NORMALS_WGSL = `fn vertexNormals(page:PageInfo,h:ClusterHeader,corners:vec3u,world3:mat3x3f,side:f32)->mat3x3f{
 let invT=invTranspose3Prep(world3);
 return mat3x3f(uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,corners.x)))*side,uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,corners.y)))*side,uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,corners.z)))*side);
}`;
