import { COTANGENT_FRAME_WGSL } from '../../cluster/decodeWgsl.ts';
import { INVERSE_TRANSPOSE_WGSL } from '../../math/inverseTransposeWgsl.ts';
import { TRIANGLE_PALETTE_WGSL } from '../../diagnostic/trianglePalette.ts';
import {
  BARY_WEIGHTS_WGSL,
  EDGE_WGSL,
  PAGE_INFO_STRUCT_WGSL,
  UV_GRADIENTS_WGSL,
} from './pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL } from './pageGeometryWgsl.ts';
import {
  COLOR_SAMPLE_WGSL,
  DATA_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  tileDeclarations,
} from '../../webgpu/tile/wgsl.ts';
import { TILE_REQUEST_WGSL } from '../../webgpu/tile/requestWgsl.ts';
import { SHADE_REQUEST_WGSL, SHADE_SUN_WGSL } from './request.ts';
import { SHADE_BINDINGS } from '../../webgpu/core/bindLayout.ts';
import { MATERIAL_CLASS_WGSL } from './materialClass.ts';
import { SURFACE_MODEL_SHADE_WGSL } from '../../scene/surfaceModel.ts';

/**
 * Declarations of the surface resolve: its bindings, the page reads, the atlas reads, the tile
 * request, the class overrides, and the two full-screen stages every class pass shares — the
 * vertex at the class depth, and the material-depth export that writes each pixel's class.
 */
export const SHADE_DECL_WGSL = `${PAGE_INFO_STRUCT_WGSL}
${SHADE_SUN_WGSL}
struct ShadeUni{viewProj:mat4x4f,viewport:vec2f,pixelRatio:f32,padViewport:f32,pageCount:u32,mode:u32,feedback:u32,pixelScale:f32,depthRamp:vec4f,sun:ShadeSun,}
@group(0) @binding(${SHADE_BINDINGS.visView}) var vis:texture_2d<u32>;
@group(0) @binding(${SHADE_BINDINGS.cache}) var<storage, read> indices:array<u32>;
@group(0) @binding(${SHADE_BINDINGS.position}) var<storage, read> positions:array<f32>;
@group(0) @binding(${SHADE_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
@group(0) @binding(${SHADE_BINDINGS.normal}) var<storage, read> normals:array<f32>;
@group(0) @binding(${SHADE_BINDINGS.pageTable}) var<storage, read> pages:array<PageInfo>;
${tileDeclarations(SHADE_BINDINGS.color, 'color')}
@group(0) @binding(${SHADE_BINDINGS.sampler}) var mapsSampler:sampler;
@group(0) @binding(${SHADE_BINDINGS.uniform}) var<uniform> uni:ShadeUni;
${tileDeclarations(SHADE_BINDINGS.data, 'data')}
${MATERIAL_CLASS_WGSL}
${TRIANGLE_PALETTE_WGSL}
${PAGE_GEOMETRY_WGSL}
fn vertN(base:u32,idx:u32)->vec3f{let i=(base+idx)*7u;return vec3f(normals[i],normals[i+1u],normals[i+2u]);}
fn vertT(base:u32,idx:u32)->vec4f{let i=(base+idx)*7u+3u;return vec4f(normals[i],normals[i+1u],normals[i+2u],normals[i+3u]);}
${PAGE_NORMAL_WGSL}
${EDGE_WGSL}
${BARY_WEIGHTS_WGSL}
${UV_GRADIENTS_WGSL}
${TILE_POOL_WGSL}
${COLOR_SAMPLE_WGSL}
${DATA_SAMPLE_WGSL}
${TILE_REQUEST_WGSL}
${SHADE_REQUEST_WGSL}
${INVERSE_TRANSPOSE_WGSL}
${COTANGENT_FRAME_WGSL}
${SURFACE_MODEL_SHADE_WGSL}
// The fifth output is the tile rank this pixel asks of virtual textures, placed in the
// feedback target that transparents complete and that a compute pass reduces into counters.
struct SurfaceOut{@location(0) baseMetal:vec4f,@location(1) normalRough:vec4f,@location(2) emissiveAo:vec4f,@location(3) flags:u32,@location(4) request:u32,}
/** A surface with nothing to light and nothing to ask: a triangle index past its page. The
 *  cutout is the raster's alone (maskKeep), never tested again here. */
fn emptySurface()->SurfaceOut{return SurfaceOut(vec4f(0.0),vec4f(0.0),vec4f(0.0),0u,0u);}
/** A diagnostic keeps the request: its textures converge like those of the image. */
fn diagnosticSurface(color:vec3f,request:u32)->SurfaceOut{return SurfaceOut(vec4f(color,0.0),vec4f(0.0),vec4f(0.0),3u,request);}
fn framebuffer(clip:vec4f)->vec3f{
 let ndc=clip.xyz/clip.w;
 return vec3f((ndc.x*0.5+0.5)*uni.viewport.x,(-ndc.y*0.5+0.5)*uni.viewport.y,ndc.z);
}
/** Full-screen triangle at the class depth: the depth test keeps the class's pixels only. */
@vertex fn shade_vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 let x=f32(i32(i&1u)*4-1);let y=f32(i32(i>>1u)*4-1);return vec4f(x,y,CLASS_DEPTH,1.0);
}
/** Material depth: the class of the pixel's page, zero on the background. */
@fragment fn material_depth_fs(@builtin(position) pos:vec4f)->@builtin(frag_depth) f32{
 return materialClassDepth(textureLoad(vis,vec2<i32>(i32(pos.x),i32(pos.y)),0).r);
}
`;
