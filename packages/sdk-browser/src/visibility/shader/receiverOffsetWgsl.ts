import { SHADING_POINT_WGSL } from './shadingPoint.ts';
import { CLASS_FEATURE } from './classWords.ts';
import { SHADE_SUN_WGSL } from './request.ts';
import {
  BARY_WEIGHTS_WGSL,
  EDGE_WGSL,
  PAGE_INFO_STRUCT_WGSL,
  VERT_NORMAL_WGSL,
} from './pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL } from './pageGeometryWgsl.ts';
import { INVERSE_TRANSPOSE_WGSL } from '../../math/inverseTransposeWgsl.ts';

/** The surface resolve's uniform (`shadeDeclWgsl.ts`), which the receiver offset re-reads: the
 *  same camera, viewport and page count the resolve placed its pixel with. */
export const SHADE_UNI_WGSL = `${SHADE_SUN_WGSL}
struct ShadeUni{viewProj:mat4x4f,viewport:vec2f,pixelRatio:f32,mipBias:f32,pageCount:u32,mode:u32,feedback:u32,pixelScale:f32,depthRamp:vec4f,sun:ShadeSun,}`;

/** A clip position on the resolve's framebuffer: pixels, then the depth. */
export const FRAMEBUFFER_WGSL = `fn framebuffer(clip:vec4f)->vec3f{
 let ndc=clip.xyz/clip.w;
 return vec3f((ndc.x*0.5+0.5)*uni.viewport.x,(-ndc.y*0.5+0.5)*uni.viewport.y,ndc.z);
}`;

/**
 * THE SHADOW RECEIVER OFFSET OF A PIXEL (#1410), recomputed where it is read — the deferred
 * lighting and the shadow demand — from the visibility buffer, rather than carried from the
 * resolve in a 12 B/px target. It is the resolve's own arithmetic, statement for statement: the
 * pixel's triangle decoded by the page geometry, placed on the resolve's framebuffer by its
 * uniform, its perspective-correct barycentrics, its vertex normals through the world's inverse
 * transpose, turned to the side a two-sided surface is lit from, then the Phong projection
 * (`shadingPointOffset`). Zero where the resolve kept the triangle's point: the background, a
 * triangle past its page, a row without vertex normals, a sprite or a line.
 */
const RECEIVER_OFFSET_FN_WGSL = `fn receiverOffset(pixel:vec2f)->vec3f{
 let id=textureLoad(vis,vec2i(i32(pixel.x),i32(pixel.y)),0).r;
 if(id==0u){return vec3f(0.0);}
 let pageIndex=(id>>8u)-1u;
 if(pageIndex>=uni.pageCount){return vec3f(0.0);}
 let tri=id&0xffu;
 let page=pages[pageIndex];
 if(tri*3u+2u>=page.indexCount||(page.materialClass&${CLASS_FEATURE.HAS_VERTEX_NORMAL}u)==0u||page.sprite.y!=0.0||page.lineWidth!=0.0){return vec3f(0.0);}
 let h=pageHeader(page);
 let corners=pageTriangle(page,h,tri);let i0=corners.x;let i1=corners.y;let i2=corners.z;
 let w0=page.world*vec4f(pagePosition(page,h,i0),1.0);let w1=page.world*vec4f(pagePosition(page,h,i1),1.0);let w2=page.world*vec4f(pagePosition(page,h,i2),1.0);
 let c0=uni.viewProj*w0;let c1=uni.viewProj*w1;let c2=uni.viewProj*w2;
 let s0=framebuffer(c0);let s1=framebuffer(c1);let s2=framebuffer(c2);
 let area=edge(s1.xy,s2.xy,s0.xy);
 var bary=vec3f(0.333,0.333,0.334);
 if(area!=0.0){
  let bw=baryWeights(s0.xy,s1.xy,s2.xy,pixel,area);let a0=bw.x;let a1=bw.y;let a2=bw.z;
  let iw0=1.0/c0.w;let iw1=1.0/c1.w;let iw2=1.0/c2.w;
  let p0w=a0*iw0;let p1w=a1*iw1;let p2w=a2*iw2;let sum=p0w+p1w+p2w;
  bary=select(vec3f(a0,a1,a2),vec3f(p0w,p1w,p2w)/sum,sum!=0.0);
 }
 let screenFace=select(-1.0,1.0,area*c0.w*c1.w*c2.w<0.0);
 let world3=mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz);
 let face=screenFace*select(-1.0,1.0,determinant(world3)>=0.0);
 let side=select(1.0,-1.0,(page.flags&256u)!=0u);
 let invT=invTranspose3Prep(world3);
 let n0=uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,i0)))*side;
 let n1=uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,i1)))*side;
 let n2=uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,i2)))*side;
 let P=(w0*bary.x+w1*bary.y+w2*bary.z).xyz;
 // The side the shading lights: a two-sided surface seen from behind lights its back (#1344).
 let lit=select(1.0,face,(page.materialClass&${CLASS_FEATURE.DOUBLE_SIDED}u)!=0u);
 return shadingPointOffset(P,bary,w0.xyz,w1.xyz,w2.xyz,n0*lit,n1*lit,n2*lit);
}`;

/** What the receiver offset binds, in binding order from the pass's first number. */
export const RECEIVER_BINDINGS = [
  'vis',
  'uniform',
  'pages',
  'indices',
  'positions',
  'uvs',
  'normals',
] as const;

/** The receiver offset with its bindings from `first` on (`RECEIVER_BINDINGS`) and the page
 *  geometry it decodes with: the one text the lighting and the shadow demand insert. */
export const receiverOffsetWgsl = (first: number) => {
  const at = (name: (typeof RECEIVER_BINDINGS)[number]) =>
    `@group(0) @binding(${first + RECEIVER_BINDINGS.indexOf(name)})`;
  return `${PAGE_INFO_STRUCT_WGSL}
${SHADE_UNI_WGSL}
${at('vis')} var vis:texture_2d<u32>;
${at('uniform')} var<uniform> uni:ShadeUni;
${at('pages')} var<storage,read> pages:array<PageInfo>;
${at('indices')} var<storage,read> indices:array<u32>;
${at('positions')} var<storage,read> positions:array<f32>;
${at('uvs')} var<storage,read> uvs:array<f32>;
${at('normals')} var<storage,read> normals:array<f32>;
${PAGE_GEOMETRY_WGSL}
${VERT_NORMAL_WGSL}
${PAGE_NORMAL_WGSL}
${EDGE_WGSL}
${BARY_WEIGHTS_WGSL}
${INVERSE_TRANSPOSE_WGSL}
${SHADING_POINT_WGSL}
${FRAMEBUFFER_WGSL}
${RECEIVER_OFFSET_FN_WGSL}`;
};
