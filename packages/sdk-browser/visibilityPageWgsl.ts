import { WRAP_MAP } from './visibilityWrapModes.ts';
import { VIS_BINDINGS } from './webgpuBindLayout.ts';

/**
 * Geometry of a page as the GPU reads it: the description of a cluster, the uniform of its draw
 * slot, and the resolution of an indirect instance's page rank. A single declaration, shared by
 * the visibility-buffer raster and by the shadow depth passes — two copies of this structure
 * would be two chances of seeing it drift.
 */
/** The six `pad*Uv` are the atlas uv scales that virtual textures made useless: a texture is
 *  read in its own space. They stay at zero, never read, until the record is recompacted
 *  (Textures backlog). */
export const PAGE_INFO_STRUCT_WGSL = `struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,padBaseUv:vec2f,clusterHash:u32,hizSlot:u32,roughnessIndex:u32,metalnessIndex:u32,normalIndex:u32,normalScale:f32,padRoughUv:vec2f,padMetalUv:vec2f,padNormalUv:vec2f,aoIndex:u32,aoIntensity:f32,padAoUv:vec2f,emissiveIndex:u32,selectionIndex:u32,emissive:vec4f,padEmissiveUv:vec2f,normalScaleY:f32,pad1:f32,pad4:vec4f,depthBias:u32,wrapModes:u32,placement:u32,pad5d:u32,}`;

/** Uniform of a visibility-buffer image, the same word for word for both rasters and the
 *  resolves: `webgpuVisibilityUniforms.ts` writes it once per slot. */
export const VIS_UNIFORMS_WGSL = `struct Uniforms{viewProj:mat4x4f,viewport:vec2f,computeSpan:f32,pageCount:u32,drawSlot:u32,indirect:u32,selectionOffset:u32,selectionEnabled:u32,}`;

/** Description of a cluster, followed by the uniform of a page-geometry pass. */
export const PAGE_INFO_WGSL = `${PAGE_INFO_STRUCT_WGSL}
${VIS_UNIFORMS_WGSL}`;

/**
 * Bindings a page-geometry pass shares, one per line. They are named rather than grouped so that
 * each pass composes them in its own order: the visibility-buffer raster thus keeps, character
 * for character, the shader text it had before shadows.
 */
export const PAGE_BINDING = {
  indices: `@group(0) @binding(${VIS_BINDINGS.cache}) var<storage, read> indices:array<u32>;`,
  positions: `@group(0) @binding(${VIS_BINDINGS.position}) var<storage, read> positions:array<f32>;`,
  pages: `@group(0) @binding(${VIS_BINDINGS.pageTable}) var<storage, read> pages:array<PageInfo>;`,
  uniforms: `@group(0) @binding(${VIS_BINDINGS.uniform}) var<uniform> uni:Uniforms;`,
  instances: `@group(0) @binding(${VIS_BINDINGS.instances}) var<storage, read> instances:array<u32>;`,
  slotOffsets: `@group(0) @binding(${VIS_BINDINGS.slotOffsets}) var<storage, read> slotOffsets:array<u32>;`,
} as const;

/** Page rank of an instance: direct in an explicit draw, via the slot table in indirect. */
export const PAGE_LOOKUP_WGSL = `fn drawPage(instanceIndex:u32)->u32{
 if(uni.indirect!=0u){return instances[slotOffsets[uni.drawSlot]+instanceIndex];}
 return instanceIndex;
}`;

/** Position of a page vertex in its local space. */
export const PAGE_VERTEX_WGSL = `fn vertPos(base:u32,idx:u32)->vec3f{let i=(base+idx)*3u;return vec3f(positions[i],positions[i+1u],positions[i+2u]);}`;

/** Texture coordinate of a page vertex. */
export const PAGE_UV_WGSL = `fn vertUv(base:u32,idx:u32)->vec2f{let i=(base+idx)*2u;return vec2f(uvs[i],uvs[i+1u]);}`;

/** Signed area of the triangle `(a,b,p)` in screen coordinates; the raster takes its barycentrics from it. */
export const EDGE_WGSL = `fn edge(a:vec2f,b:vec2f,p:vec2f)->f32{return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}`;

/**
 * The three affine barycentric weights of the point `p`, the signed area already known, for
 * visibility-buffer shading. The compute raster has its own: it decides coverage on its three
 * edges, and a weight derived by `1-w0-w1` is not watertight. Requires `EDGE_WGSL`.
 */
export const BARY_WEIGHTS_WGSL = `fn baryWeights(a:vec2f,b:vec2f,c:vec2f,p:vec2f,area:f32)->vec3f{
 let w0=edge(b,c,p)/area;let w1=edge(c,a,p)/area;
 return vec3f(w0,w1,1.0-w0-w1);
}`;

/**
 * Texture coordinate of a vertex and the opacity-mask test of a cluster, as both the
 * visibility-buffer raster and the shadow depth pass apply them. A single write: a cutout that
 * was not the same on both sides would make a shadow that does not match the silhouette one
 * sees. `flags`: 4 = UVs present, 8 = base map, 128 = masked material; the threshold is
 * `baseColor.w`, and the base map's addressing mode comes from the per-map word, never from the
 * material flags.
 *
 * `ddx`, `ddy` are the per-texel derivatives of the coordinate of the pass that reads — camera
 * pixel or shadow texel —: each reads the map at the level of its footprint, as the materials
 * pass reads its colour (`maskAlpha`, `webgpuTileWgsl.ts`). The compute raster, which has no
 * derivatives, passes zero and reads level 0 — the finest resident tile under that texel.
 *
 * The host shader declares `uvs`, the colour pool and its page table, then inserts
 * `TILE_POOL_WGSL` (which carries the addressing rule), `COLOR_SAMPLE_WGSL` and
 * `maskAlphaWgsl(...)` before this block.
 */
export const MASK_KEEP_WGSL = `fn maskKeep(page:PageInfo,uv:vec2f,ddx:vec2f,ddy:vec2f)->bool{
 if((page.flags&128u)==0u||(page.flags&8u)==0u){return true;}
 // Levels of the chain take the MEDIAN of alpha, never its mean: a coarse texel passes the
 // threshold when half of what it covers passed it, so threshold coverage crosses the levels and
 // the cutout stays right at every level. A mean, itself, made the silhouette grow level after
 // level and made the quad opaque during loading.
 return maskAlpha(page.mapIndex,uv,wrapOf(page.wrapModes,${WRAP_MAP.base}u),ddx,ddy)>=page.baseColor.w;
}`;

/** The mask test preceded by the texture coordinate a page vertex supplies it. */
export const PAGE_MASK_WGSL = `${PAGE_UV_WGSL}
${MASK_KEEP_WGSL}`;
