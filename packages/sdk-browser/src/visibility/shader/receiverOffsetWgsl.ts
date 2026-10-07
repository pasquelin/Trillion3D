import { SHADING_POINT_WGSL } from './shadingPoint.ts'
import { CLASS_FEATURE } from './classWords.ts'
import {
  FRAMEBUFFER_WGSL,
  PIXEL_BARY_WGSL,
  SHADE_UNI_WGSL,
  VERTEX_NORMALS_WGSL,
} from './pixelTriangleWgsl.ts'
import { BARY_WEIGHTS_WGSL, EDGE_WGSL, PAGE_INFO_STRUCT_WGSL, normalAtlasWgsl } from './pageWgsl.ts'
import { PAGE_NORMAL_WGSL, PAGE_POINTS_WGSL } from './pageGeometryWgsl.ts'
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
const RECEIVER_OFFSET_FN_WGSL = wgslBlock(
  'RECEIVER_OFFSET_FN_WGSL',
  [],
  `struct ShadowReceiver{offset:vec3f,plane:vec3f,}
fn shadowReceiver(pixel:vec2f)->ShadowReceiver{
 let none=ShadowReceiver(vec3f(0.0),vec3f(0.0));
 let id=textureLoad(vis,vec2i(i32(pixel.x),i32(pixel.y)),0).r;
 if(id==0u){return none;}
 let pageIndex=(id>>8u)-1u;
 if(pageIndex>=uni.pageCount){return none;}
 let tri=id&0xffu;
 let page=pages[pageIndex];
 if(tri*3u+2u>=page.indexCount||(page.materialClass&${CLASS_FEATURE.HAS_VERTEX_NORMAL}u)==0u||page.sprite.y!=0.0||page.lineWidth!=0.0){return none;}
 let h=pageHeader(page);
 let corners=pageTriangle(page,h,tri);let i0=corners.x;let i1=corners.y;let i2=corners.z;
 let w0=page.world*vec4f(pagePosition(page,h,i0),1.0);let w1=page.world*vec4f(pagePosition(page,h,i1),1.0);let w2=page.world*vec4f(pagePosition(page,h,i2),1.0);
 let c0=uni.viewProj*w0;let c1=uni.viewProj*w1;let c2=uni.viewProj*w2;
 let s0=framebuffer(c0);let s1=framebuffer(c1);let s2=framebuffer(c2);
 let area=edge(s1.xy,s2.xy,s0.xy);
 let bary=pixelBary(s0,s1,s2,c0,c1,c2,pixel,area);
 let screenFace=select(-1.0,1.0,area*c0.w*c1.w*c2.w<0.0);
 let world3=worldMatrix3(page.world);
 let face=screenFace*select(-1.0,1.0,windingKept(world3));
 let side=select(1.0,-1.0,(page.flags&256u)!=0u);
 let n=vertexNormals(page,h,corners,world3,side);
 let P=(w0*bary.x+w1*bary.y+w2*bary.z).xyz;
 // The side the shading lights: a two-sided surface seen from behind lights its back.
 let lit=select(1.0,face,(page.materialClass&${CLASS_FEATURE.DOUBLE_SIDED}u)!=0u);
 // The triangle's own plane, which the shadow bias follows (\`shadowBiasNormal\`).
 let plane=cross(w1.xyz-w0.xyz,w2.xyz-w0.xyz);
 let offset=shadingPointOffset(P,bary,w0.xyz,w1.xyz,w2.xyz,n[0]*lit,n[1]*lit,n[2]*lit);
 return ShadowReceiver(offset,select(vec3f(0.0),normalize(plane),dot(plane,plane)>0.0));
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
      worldMatrix3,
      windingKept,
      VERTEX_NORMALS_WGSL,
      FRAMEBUFFER_WGSL,
      PAGE_INFO_STRUCT_WGSL,
      SHADE_UNI_WGSL,
      normalAtlasWgsl(first + RECEIVER_BINDINGS.indexOf('normals')),
      PAGE_NORMAL_WGSL,
      EDGE_WGSL,
      BARY_WEIGHTS_WGSL,
      PIXEL_BARY_WGSL,
      SHADING_POINT_WGSL,
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
