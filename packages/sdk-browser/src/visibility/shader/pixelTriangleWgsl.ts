import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  InvT3,
  invTranspose3Apply,
  invTranspose3Prep,
  uniteOuZero,
} from '../../../../math/src/wgsl/inverseTranspose.ts'
import { perspectiveBarycentric } from '../../../../math/src/wgsl/barycentric.ts'
import { clipToFramebuffer } from '../../../../math/src/wgsl/projection.ts'
/**
 * How the surface resolve places a pixel on its triangle, shared by the resolve (`shadeWgsl.ts`)
 * and the shadow receiver offset its readers recompute (`receiverOffsetWgsl.ts`): one text,
 * so the offset follows the very point and normals the resolve shaded.
 */

/** The surface resolve's uniform: its camera, viewport and page count. */
export const SHADE_UNI_WGSL = wgslBlock(
  'SHADE_UNI_WGSL',
  [],
  `struct ShadeUni{viewProj:mat4x4f,viewport:vec2f,pixelRatio:f32,mipBias:f32,pageCount:u32,mode:u32,feedback:u32,depthRamp:vec4f,}`,
)

/** A clip position on the resolve's framebuffer: pixels, then the depth. */
export const FRAMEBUFFER_WGSL = wgslBlock(
  'FRAMEBUFFER_WGSL',
  [clipToFramebuffer],
  'fn framebuffer(clip:vec4f)->vec3f{return clipToFramebuffer(clip,uni.viewport);}',
)

/** The perspective-correct barycentrics of `p` in the screen triangle `s0..s2` of clip corners
 *  `c0..c2` and signed area `area`; a fixed third each on a degenerate triangle. `perspectiveBarycentric`
 *  takes the corners' `1/w` (\`iw\`), which the resolve reads with its triangle (`decodeTriangle`). */
export const PIXEL_BARY_WGSL = wgslBlock(
  'PIXEL_BARY_WGSL',
  [perspectiveBarycentric],
  `fn pixelBary(s0:vec3f,s1:vec3f,s2:vec3f,c0:vec4f,c1:vec4f,c2:vec4f,p:vec2f,area:f32)->vec3f{
 return perspectiveBarycentric(s0,s1,s2,vec3f(1.0/c0.w,1.0/c1.w,1.0/c2.w),p,area);
}`,
)

/**
 * The triangle's three vertex normals in the world, one per column, turned to `side`. The three
 * undergo the SAME matrix: normalisation, determinant and adjugate are computed once for the
 * pixel (`invTranspose3Prep`, or the row's frame the resolve reads, `shadeCacheWgsl.ts`), and each
 * normal only keeps the 3×3 product. uniteOuZero returns normalize on any non-zero vector; it only
 * differs where normalize would yield NaN — collapsed face, degenerate triangle. On a rank-2 pose,
 * invTranspose3Apply returns the transformed FACE normal: the three vertex normals fall on the same
 * direction, and interpolation keeps it.
 */
export const VERTEX_NORMALS_WGSL = wgslBlock(
  'VERTEX_NORMALS_WGSL',
  [invTranspose3Prep, invTranspose3Apply, uniteOuZero],
  `fn vertexNormals(page:PageInfo,h:ClusterHeader,corners:vec3u,world3:mat3x3f,side:f32)->mat3x3f{
 return transformedNormals(page,h,corners,invTranspose3Prep(world3),side);
}
fn transformedNormals(page:PageInfo,h:ClusterHeader,corners:vec3u,invT:InvT3,side:f32)->mat3x3f{
 return mat3x3f(uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,corners.x)))*side,uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,corners.y)))*side,uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,corners.z)))*side);
}`,
)

/**
 * The triangle a pixel shades, all the resolve reads of its page: each corner on the framebuffer —
 * its pixel in x and y (`framebuffer`), its clip depth and w — (`p0..p2`), in the world (`w0..w2`,
 * a sprite's quad turned to the camera), its normal in the world turned to the row's side
 * (`n0..n2`), its texture coordinate (`uva..uvc`) and its clip `1/w` (`iw`, the perspective of
 * the barycentrics and of the texture derivatives). `decodeTriangle` decodes it from the page as
 * every pixel did; the frame cache stores what it returns for a triangle two pixels or more read
 * (`shadeCacheWgsl.ts`), and those pixels read the words instead. Requires the page geometry, its
 * screen and normals; it lists the rest.
 */
export const PIXEL_TRIANGLE_WGSL = wgslBlock(
  'PIXEL_TRIANGLE_WGSL',
  [InvT3, FRAMEBUFFER_WGSL, VERTEX_NORMALS_WGSL],
  `struct PixelTriangle{p0:vec4f,p1:vec4f,p2:vec4f,w0:vec4f,w1:vec4f,w2:vec4f,n0:vec3f,n1:vec3f,n2:vec3f,uva:vec2f,uvb:vec2f,uvc:vec2f,iw:vec3f,}
fn decodeTriangle(page:PageInfo,tri:u32,invT:InvT3)->PixelTriangle{
 let h=pageHeader(page);
 let corners=pageTriangle(page,h,tri);let i0=corners.x;let i1=corners.y;let i2=corners.z;
 let p0=pagePosition(page,h,i0);let p1=pagePosition(page,h,i1);let p2=pagePosition(page,h,i2);
 var w0=page.world*vec4f(p0,1.0);var w1=page.world*vec4f(p1,1.0);var w2=page.world*vec4f(p2,1.0);
 // A sprite page's triangle is its quad turned to the camera (\`pageSprite\`), as the rasters drew it.
 if(page.sprite.y!=0.0){w0=pageSprite(page,p0);w1=pageSprite(page,p1);w2=pageSprite(page,p2);}
 var c0=uni.viewProj*w0;var c1=uni.viewProj*w1;var c2=uni.viewProj*w2;
 // A line page's triangle is the quad the rasters widened (\`pageLine\`): its corners are read the same way.
 if(page.lineWidth>0.0){let vp=uni.viewProj*page.world;c0=pageLine(page,h,i0,vp,c0);c1=pageLine(page,h,i1,vp,c1);c2=pageLine(page,h,i2,vp,c2);}
 let s0=framebuffer(c0);let s1=framebuffer(c1);let s2=framebuffer(c2);
 let n=transformedNormals(page,h,corners,invT,select(1.0,-1.0,(page.flags&256u)!=0u));
 return PixelTriangle(vec4f(s0.xy,c0.zw),vec4f(s1.xy,c1.zw),vec4f(s2.xy,c2.zw),w0,w1,w2,n[0],n[1],n[2],pageUv(page,h,i0),pageUv(page,h,i1),pageUv(page,h,i2),vec3f(1.0/c0.w,1.0/c1.w,1.0/c2.w));
}`,
)
