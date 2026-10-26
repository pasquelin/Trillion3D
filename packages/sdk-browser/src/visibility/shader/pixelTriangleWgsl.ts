import { SHADE_UNIFORM } from './uniformLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  InvT3,
  invTranspose3Apply,
  invTranspose3Prep,
  unitOrZero,
} from '../../../../math/src/wgsl/inverseTranspose.ts'
import { windingKept, worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { clipToFramebuffer } from '../../../../math/src/wgsl/projection.ts'
import { SHADE_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { materialTableWgsl } from '../../materials/table/materialWgsl.ts'
import { PAGE_SHAPE_WGSL } from './pageShapeWgsl.ts'
import { FLAG_BACK } from '../types.ts'
import { CARD_VIEW_READ_WGSL } from '../../lighting/surfaceCache/capture/cardViewTable.ts'
/**
 * How the surface resolve places a pixel on its triangle (`shadeWgsl.ts`).
 */

/** The surface resolve's uniform: its camera, viewport and the clusters' count. */
export const SHADE_UNI_WGSL = wgslBlock('SHADE_UNI_WGSL', [], SHADE_UNIFORM.wgsl)

/**
 * The view a row is placed by. An image places every row by its uniform's view (`viewProj`,
 * `viewport`); the image of a capture of the surface cache's cards (the class set compiled with `CARD_VIEWS`) places each by the
 * view of its own — an orthographic view of one card's page, its picture the rectangle `rect` of the
 * image —, the record `cardViewAt` reads from the rows of the identifier texture past the image, at the
 * rank the row's `depthBias` names (`../../lighting/surfaceCache/capture/cardViewTable.ts`). A row is
 * selected once a pixel (`shadeSelectRow`); the view's matrix, and a clip position's pixel on the image
 * (`framebuffer`), then follow it.
 */
const SHADE_VIEW_WGSL = wgslBlock(
  'SHADE_VIEW_WGSL',
  [clipToFramebuffer, CARD_VIEW_READ_WGSL],
  `/** Whether the image is a capture of cards: the class set of a capture is compiled with it, the main view's without. */
override CARD_VIEWS:bool=false;
struct ShadeCardView{viewProj:mat4x4f,rect:vec4u,}
var<private> shadeCard:ShadeCardView;
/** Word \`k\` of view \`view\`'s record, a texel of the identifier texture's row \`view\` past the image. */
fn cardWord(view:u32,k:u32)->u32{return textureLoad(vis,vec2i(i32(k),i32(textureDimensions(vis).x+view)),0).r;}
fn cardViewAt(view:u32)->ShadeCardView{return ShadeCardView(cardMatrix(view),cardRect(view));}
/** Selects the view of row \`row\` of the table: the image's own, but in a capture of cards. */
fn shadeSelectRow(row:u32){if(CARD_VIEWS){shadeCard=cardViewAt(pages[row].depthBias);}}
/** The matrix the selected row is placed by. */
fn shadeViewProj()->mat4x4f{
 if(CARD_VIEWS){return shadeCard.viewProj;}
 return uni.viewProj;
}
/** A clip position on the resolve's framebuffer: pixels, then the depth. */
fn framebuffer(clip:vec4f)->vec3f{
 if(CARD_VIEWS){
  let f=clipToFramebuffer(clip,vec2f(shadeCard.rect.zw));
  return vec3f(f.xy+vec2f(shadeCard.rect.xy),f.z);
 }
 return clipToFramebuffer(clip,uni.viewport);
}`,
)

/**
 * The triangle's three vertex normals in the world, one per column, turned to `side`. The three
 * undergo the SAME matrix: normalisation, determinant and adjugate are computed once for the
 * pixel (`invTranspose3Prep`), and each normal only keeps the 3×3 product. unitOrZero returns normalize on any non-zero vector; it only
 * differs where normalize would yield NaN — collapsed face, degenerate triangle. On a rank-2 pose,
 * invTranspose3Apply returns the transformed FACE normal: the three vertex normals fall on the same
 * direction, and interpolation keeps it.
 */
const VERTEX_NORMALS_WGSL = wgslBlock(
  'VERTEX_NORMALS_WGSL',
  [invTranspose3Apply, unitOrZero],
  `fn transformedNormals(page:PageInfo,h:ClusterHeader,corners:vec3u,invT:InvT3,side:f32)->mat3x3f{
 return mat3x3f(unitOrZero(invTranspose3Apply(invT,pageNormal(page,h,corners.x)))*side,unitOrZero(invTranspose3Apply(invT,pageNormal(page,h,corners.y)))*side,unitOrZero(invTranspose3Apply(invT,pageNormal(page,h,corners.z)))*side);
}`,
)

/**
 * The triangle a pixel shades, all the resolve reads of its page: each corner on the framebuffer —
 * its pixel in x and y (`framebuffer`), its clip depth and w — (`p0..p2`), in the world (`w0..w2`,
 * a sprite's quad turned to the camera), its normal in the world turned to the row's side
 * (`n0..n2`), its texture coordinate (`uva..uvc`) and its clip `1/w` (`iw`, the perspective of
 * the barycentrics and of the texture derivatives), a sprite's or a line's at its row's `shape`;
 * and the cluster's header (`h`) and the page's corners of the triangle (`k`), which every reader
 * of the pixel's page takes from here — the header and the corners are read once a pixel.
 * `decodeCorners` decodes all of it but the texture coordinates (zero); `decodeTriangle` adds them:
 * every pixel decodes and transforms its own triangle (`pixelTriangle`). Requires the page
 * geometry, its screen and normals; it lists the rest.
 */
const PIXEL_CORNERS_WGSL = wgslBlock(
  'PIXEL_CORNERS_WGSL',
  [InvT3, SHADE_VIEW_WGSL, VERTEX_NORMALS_WGSL],
  `struct PixelTriangle{p0:vec4f,p1:vec4f,p2:vec4f,w0:vec4f,w1:vec4f,w2:vec4f,n0:vec3f,n1:vec3f,n2:vec3f,uva:vec2f,uvb:vec2f,uvc:vec2f,iw:vec3f,h:ClusterHeader,k:vec3u,}
fn decodeCorners(page:PageInfo,h:ClusterHeader,corners:vec3u,invT:InvT3,shape:PageShape)->PixelTriangle{
 let i0=corners.x;let i1=corners.y;let i2=corners.z;
 let p=pageTrianglePositions(page,h,corners);let p0=p[0];let p1=p[1];let p2=p[2];
 var w0=page.world*vec4f(p0,1.0);var w1=page.world*vec4f(p1,1.0);var w2=page.world*vec4f(p2,1.0);
 // A sprite page's triangle is its quad turned to the camera (\`pageSprite\`), as the rasters drew it.
 if(shape.sprite.y!=0.0){w0=pageSprite(page,p0,shape.sprite);w1=pageSprite(page,p1,shape.sprite);w2=pageSprite(page,p2,shape.sprite);}
 var c0=shadeViewProj()*w0;var c1=shadeViewProj()*w1;var c2=shadeViewProj()*w2;
 // A line page's triangle is the quad the rasters widened (\`pageLine\`): its corners are read the same way.
 if(shape.lineWidth>0.0){let vp=shadeViewProj()*page.world;let width=shape.lineWidth;c0=pageLine(page,h,i0,vp,c0,width);c1=pageLine(page,h,i1,vp,c1,width);c2=pageLine(page,h,i2,vp,c2,width);}
 let s0=framebuffer(c0);let s1=framebuffer(c1);let s2=framebuffer(c2);
 let n=transformedNormals(page,h,corners,invT,select(1.0,-1.0,(page.flags&${FLAG_BACK}u)!=0u));
 return PixelTriangle(vec4f(s0.xy,c0.zw),vec4f(s1.xy,c1.zw),vec4f(s2.xy,c2.zw),w0,w1,w2,n[0],n[1],n[2],vec2f(0.0),vec2f(0.0),vec2f(0.0),vec3f(1.0/c0.w,1.0/c1.w,1.0/c2.w),h,corners);
}`,
)

/** `PIXEL_CORNERS_WGSL` with the page's texture coordinates and its cluster's shape, read off the
 *  material table at the resolve's binding: the triangle the resolve shades, decoded by the pixel
 *  (`pixelTriangle`), whose normals are turned by its world's inverse transpose and whose winding
 *  is that of its world's determinant (`worldWindingKept`, `matrixWindingCw`). */
export const PIXEL_TRIANGLE_WGSL = wgslBlock(
  'PIXEL_TRIANGLE_WGSL',
  [
    PIXEL_CORNERS_WGSL,
    PAGE_SHAPE_WGSL,
    materialTableWgsl(SHADE_BINDINGS.material),
    invTranspose3Prep,
    worldMatrix3,
    windingKept,
  ],
  `fn decodeTriangle(page:PageInfo,tri:u32,invT:InvT3)->PixelTriangle{
 let h=pageHeader(page);
 let corners=pageTriangle(page,h,tri);
 // Only a class of sprites and lines reads the shape record (\`SHAPED\`).
 var shape=PageShape(vec2f(0.0),0.0);
 if(SHAPED){shape=pageShape(page);}
 var t=decodeCorners(page,h,corners,invT,shape);
  t.uva=pageUv(page,h,corners.x);t.uvb=pageUv(page,h,corners.y);t.uvc=pageUv(page,h,corners.z);
 return t;
}
/** The triangle \`tri\` of \`page\` as its pixel shades it: decoded and transformed here. */
fn pixelTriangle(page:PageInfo,tri:u32)->PixelTriangle{return decodeTriangle(page,tri,invTranspose3Prep(worldMatrix3(page.world)));}
/** Whether \`page\`'s world keeps the winding of its triangles. */
fn worldWindingKept(page:PageInfo)->bool{return windingKept(worldMatrix3(page.world));}`,
)
