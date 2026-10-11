import { SHADING_POINT_WGSL } from './shadingPoint.ts'
import { SHADOW_RECEIVER_STRUCT_WGSL } from './receiverTargetWgsl.ts'
import { CLASS_FEATURE } from './classWords.ts'
import { PIXEL_CORNERS_WGSL, SHADE_UNI_WGSL } from './pixelTriangleWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from './pageWgsl.ts'
import { edgeFunction, perspectiveBarycentric } from '../../../../math/src/wgsl/barycentric.ts'
import { faceNormal } from '../../../../math/src/wgsl/geometry.ts'
import { invTranspose3Prep, unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { PAGE_NORMAL_WGSL, PAGE_POINTS_WGSL, PAGE_SCREEN_WGSL } from './pageGeometryWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { windingKept, worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'

/**
 * THE SHADOW RECEIVER OF A PIXEL: its shading-point offset and its triangle's plane, the
 * one the shadow bias follows, recomputed where they are read — the deferred lighting and
 * the shadow demand — from the visibility buffer; only the virtual shadow maps' projection reads
 * the copy the resolve writes (`receiverTargetWgsl.ts`, 8 B/px). It is the resolve's own
 * arithmetic, its shared parts called, not copied (`pixelTriangleWgsl.ts`): the pixel's triangle
 * decoded by the page geometry, placed on the resolve's framebuffer by its uniform, its
 * perspective-correct barycentrics, its vertex normals through the world's inverse transpose,
 * turned to the side a two-sided surface is lit from, then the Phong projection
 * (`shadingPointOffset`). Zero where the resolve kept the triangle's point: the background, a
 * triangle past its page, a row without vertex normals, a sprite or a line.
 */
/**
 * The receiver of a pixel whose triangle is decoded: its barycentrics `bary` in the world corners
 * `w0 w1 w2`, their vertex normals `n0 n1 n2` turned to the side `lit` (±1) the shading lights,
 * the Phong projection of its point (`shadingPointOffset`) and the triangle's own plane, which the
 * shadow bias follows (`shadowBiasNormal`), not normalised. The one arithmetic of the resolve, which
 * writes the receiver target once, and of the readers that decode the triangle themselves.
 */
export const SHADOW_RECEIVER_OF_TRIANGLE_WGSL = wgslBlock(
  'SHADOW_RECEIVER_OF_TRIANGLE_WGSL',
  [SHADOW_RECEIVER_STRUCT_WGSL, SHADING_POINT_WGSL, faceNormal],
  `fn shadowReceiverOfTriangle(bary:vec3f,w0:vec4f,w1:vec4f,w2:vec4f,n0:vec3f,n1:vec3f,n2:vec3f,lit:f32)->ShadowReceiver{
 let P=(w0*bary.x+w1*bary.y+w2*bary.z).xyz;
 return ShadowReceiver(shadingPointOffset(P,bary,w0.xyz,w1.xyz,w2.xyz,n0*lit,n1*lit,n2*lit),faceNormal(w0.xyz,w1.xyz,w2.xyz));
}`,
)

const RECEIVER_OFFSET_FN_WGSL = wgslBlock(
  'RECEIVER_OFFSET_FN_WGSL',
  [
    PIXEL_CORNERS_WGSL,
    PAGE_SCREEN_WGSL,
    edgeFunction,
    perspectiveBarycentric,
    invTranspose3Prep,
    worldMatrix3,
    windingKept,
    SHADOW_RECEIVER_OF_TRIANGLE_WGSL,
    unitOrZero,
  ],
  `fn shadowReceiver(pixel:vec2f)->ShadowReceiver{
 let none=ShadowReceiver(vec3f(0.0),vec3f(0.0));
 let id=textureLoad(vis,vec2i(i32(pixel.x),i32(pixel.y)),0).r;
 if(id==0u){return none;}
 let pageIndex=(id>>8u)-1u;
 if(pageIndex>=uni.pageCount){return none;}
 let tri=id&0xffu;
 let page=pages[pageIndex];
 if(tri*3u+2u>=page.indexCount||(page.materialClass&${CLASS_FEATURE.HAS_VERTEX_NORMAL}u)==0u||page.sprite.y!=0.0||page.lineWidth!=0.0){return none;}
 let h=pageHeader(page);
 let world3=worldMatrix3(page.world);
 let t=decodeCorners(page,h,pageTriangle(page,h,tri),invTranspose3Prep(world3));
 let w0=t.w0;let w1=t.w1;let w2=t.w2;
 let s0=t.p0.xyz;let s1=t.p1.xyz;let s2=t.p2.xyz;
 let area=edgeFunction(s1.xy,s2.xy,s0.xy);
 let bary=perspectiveBarycentric(s0,s1,s2,t.iw,pixel,area);
 let screenFace=select(-1.0,1.0,area*t.p0.w*t.p1.w*t.p2.w<0.0);
 let face=screenFace*select(-1.0,1.0,windingKept(world3));
 // The side the shading lights: a two-sided surface seen from behind lights its back.
 let lit=select(1.0,face,(page.materialClass&${CLASS_FEATURE.DOUBLE_SIDED}u)!=0u);
 let receiver=shadowReceiverOfTriangle(bary,w0,w1,w2,t.n0,t.n1,t.n2,lit);
 return ShadowReceiver(receiver.offset,unitOrZero(receiver.plane));
}`,
)

/** What the receiver offset binds, in binding order from the pass's first number: never the
 *  texture coordinates, which it does not read; the float pool's positions, and its normals from
 *  their atlas (`../../webgpu/core/floatAtlas.ts`) — three storage buffers, which the lighting and
 *  the demand hold within their eight (`bindBudget.test.ts`). */
export const RECEIVER_BINDINGS = [
  'vis',
  'uniform',
  'pages',
  'indices',
  'positions',
  'normals',
] as const

/** The receiver offset with its bindings from `first` on (`RECEIVER_BINDINGS`) and the page
 *  geometry it decodes with: the one text the lighting and the shadow demand insert. */
export const receiverOffsetWgsl = (first: number) => {
  const at = (name: (typeof RECEIVER_BINDINGS)[number]) =>
    `@group(0) @binding(${first + RECEIVER_BINDINGS.indexOf(name)})`
  return wgslBlock(
    `receiverOffsetWgsl(${first})`,
    [
      PAGE_POINTS_WGSL,
      PAGE_INFO_STRUCT_WGSL,
      SHADE_UNI_WGSL,
      normalAtlasWgsl(first + RECEIVER_BINDINGS.indexOf('normals')),
      PAGE_NORMAL_WGSL,
      RECEIVER_OFFSET_FN_WGSL,
    ],
    `${at('vis')} var vis:texture_2d<u32>;
${at('uniform')} var<uniform> uni:ShadeUni;
${at('pages')} var<storage,read> pages:array<PageInfo>;
${at('indices')} var<storage,read> indices:array<u32>;
${at('positions')} var<storage,read> positions:array<f32>;
`,
  )
}
