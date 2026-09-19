import {
  COLOR_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  maskAlphaWgsl,
  tileDeclarations,
} from './webgpuTileWgsl.ts';
import {
  EDGE_WGSL,
  MASK_KEEP_WGSL,
  PAGE_INFO_STRUCT_WGSL,
  VIS_UNIFORMS_WGSL,
} from './visibilityPageWgsl.ts';
import { SMALL_BINDINGS } from './webgpuBindLayout.ts';
import { RASTER_TRI_WGSL } from './gpuRasterTriWgsl.ts';
import { COMPUTE_TAKES_WGSL } from './gpuRasterContract.ts';
import { RASTER_PIXEL_WGSL } from './gpuRasterPixelWgsl.ts';
import { rasterKernels } from './gpuRasterKernelsWgsl.ts';
import { DEPTH_CLEAR } from './depthConvention.ts';
import { wgslFloat } from './gpuPartitionMargins.ts';

/**
 * Compute raster of the share of the opaque and masked cut that the split gives it — the small
 * triangles, or the whole cut: it writes a visibility buffer — a depth and a cluster/triangle
 * identifier per pixel — which the full-screen hardware resolve then merges into the identifier
 * texture, the depth and pyramid level zero that the hardware raster opened. Blend and
 * transmission surfaces keep their pass.
 *
 * A mask material does its alpha test HERE, on the finest already-resident tile — this raster
 * has no derivatives and passes null gradients to `maskKeep`, the same test as the frame and
 * shadows, at the same threshold, on the same coordinates.
 */
const PAGE_INFO = `${PAGE_INFO_STRUCT_WGSL}
${VIS_UNIFORMS_WGSL}`;

export const rasterSource = (capacity: number, listBase: number) => `${PAGE_INFO}
@group(0) @binding(${SMALL_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${SMALL_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${SMALL_BINDINGS.hizFlags}) var<storage,read> hizFlags:array<u32>;
@group(0) @binding(${SMALL_BINDINGS.uniform}) var<uniform> uni:Uniforms;
@group(0) @binding(${SMALL_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;
${tileDeclarations(SMALL_BINDINGS.color, 'color')}
@group(0) @binding(${SMALL_BINDINGS.sampler}) var mapsSampler:sampler;
// One work buffer: first the two attachments the raster resolves — depth, then identifiers one
// screen further —, and from LIST the two triangle lists, their counts, the dispatches they
// imply, then one row and one triangle per entry.
@group(0) @binding(${SMALL_BINDINGS.work}) var<storage,read_write> work:array<atomic<u32>>;
const LIST:u32=${listBase}u;
@group(0) @binding(${SMALL_BINDINGS.selectionMask}) var<storage,read> selectionMask:array<u32>;
${TILE_POOL_WGSL}
${COLOR_SAMPLE_WGSL}
${maskAlphaWgsl(false)}
fn pixelCount()->u32{return u32(uni.viewport.x)*u32(uni.viewport.y);}
// The \`viewProj * world\` product and the linear-part determinant depend only on the page: they
// are computed once for the page and reread as-is by each of its triangles. The same operands
// in the same order give the same float as a per-triangle compute.
fn pageTransform(page:PageInfo)->mat4x4f{return uni.viewProj*page.world;}
fn pageWinding(page:PageInfo)->f32{return determinant(mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz));}
fn vertex(vp:mat4x4f,vertexBase:u32,index:u32)->vec4f{
 let base=(vertexBase+index)*3u;
 return vp*vec4f(positions[base],positions[base+1u],positions[base+2u],1.0);
}
fn uv(page:PageInfo,index:u32)->vec2f{let base=(page.vertexBase+index)*2u;return vec2f(uvs[base],uvs[base+1u]);}
${EDGE_WGSL}
${COMPUTE_TAKES_WGSL}
${MASK_KEEP_WGSL}
${RASTER_TRI_WGSL}
${RASTER_PIXEL_WGSL}
${rasterKernels(capacity)}`;

/**
 * Full-screen hardware resolve: a triangle that covers the screen rereads the work buffer and
 * writes each pixel back into the attachments consumers already read — identifiers as `r32uint`,
 * depth-buffer depth, linear depth of pyramid level zero. No consumer changes: it is the
 * producer that changed.
 *
 * `hiz` serves between the two halves of the frame: the pyramid needs occluder depth before any
 * identifier has been resolved, so it only writes level zero and the depth buffer. `one` and
 * `two` close the frame, when depth is final and the identifier chosen. All pass the depth test
 * against what the hardware raster already wrote: that is where the two producers merge, pixel
 * by pixel.
 */
export const RESOLVE = `${VIS_UNIFORMS_WGSL}
@group(0) @binding(0) var<storage,read> frame:array<u32>;
@group(0) @binding(1) var<uniform> uni:Uniforms;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);}
struct One{@location(0) id:u32,@builtin(frag_depth) depth:f32,}
struct Two{@location(0) id:u32,@location(1) hiz:f32,@builtin(frag_depth) depth:f32,}
struct Hiz{@location(0) hiz:f32,@builtin(frag_depth) depth:f32,}
fn offset(pos:vec4f)->u32{return u32(pos.y)*u32(uni.viewport.x)+u32(pos.x);}
fn pixelCount()->u32{return u32(uni.viewport.x)*u32(uni.viewport.y);}
@fragment fn one(@builtin(position) pos:vec4f)->One{let i=offset(pos);let id=frame[pixelCount()+i];if(id==0xffffffffu){discard;}return One(id,bitcast<f32>(frame[i]));}
@fragment fn two(@builtin(position) pos:vec4f)->Two{let i=offset(pos);let id=frame[pixelCount()+i];if(id==0xffffffffu){discard;}let depth=bitcast<f32>(frame[i]);return Two(id,depth,depth);}
@fragment fn hiz(@builtin(position) pos:vec4f)->Hiz{let d=bitcast<f32>(frame[offset(pos)]);if(d<=${wgslFloat(DEPTH_CLEAR)}){discard;}return Hiz(d,d);}`;
