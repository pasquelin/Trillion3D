import { FLAG_HAS_COLOR, FLAG_SAMPLED } from '../types.ts';
import { TAA_SAMPLES } from '../../taa/jitter.ts';
import { VIS_BINDINGS } from '../../webgpu/core/bindLayout.ts';

/**
 * Geometry of a page as the GPU reads it: the description of a cluster, the uniform of its draw
 * slot, and the resolution of an indirect instance's page rank. A single declaration, shared by
 * the visibility-buffer raster and by the shadow depth passes — two copies of this structure
 * would be two chances of seeing it drift.
 */
/** The six `pad*Uv` are the atlas uv scales that virtual textures made useless: a texture is
 *  read in its own space. They stay at zero, never read, until the record is recompacted
 *  (Textures backlog). */
export const PAGE_INFO_STRUCT_WGSL = `struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,padBaseUv:vec2f,clusterHash:u32,hizSlot:u32,roughnessIndex:u32,metalnessIndex:u32,normalIndex:u32,normalScale:f32,padRoughUv:vec2f,padMetalUv:vec2f,padNormalUv:vec2f,aoIndex:u32,aoIntensity:f32,padAoUv:vec2f,emissiveIndex:u32,selectionIndex:u32,emissive:vec4f,padEmissiveUv:vec2f,normalScaleY:f32,pad1:f32,screenError:f32,blendCoverage:f32,pad4:vec2f,depthBias:u32,lineWidth:f32,placement:u32,materialClass:u32,}`;

/** Uniform of a visibility-buffer image, the same word for word for both rasters and the
 *  resolves: `../../webgpu/visibility/uniforms.ts` writes it once per slot. `stipple` is the
 *  temporal rank of the cutout stipple plus one, zero when the image does not accumulate
 *  (`STIPPLE_WGSL`). `pixelRatio` is the host's image pixels per CSS pixel, the scale of a line's
 *  width (`lineWgsl.ts`). Its size is `VIS_UNIFORM_BYTES`. */
export const VIS_UNIFORMS_WGSL = `struct Uniforms{viewProj:mat4x4f,viewport:vec2f,computeSpan:f32,pageCount:u32,drawSlot:u32,indirect:u32,selectionOffset:u32,selectionEnabled:u32,stipple:u32,pixelRatio:f32,}`;

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
 * Screen gradients (per pixel in x, then y) of the perspective-correct coordinate at `p` in the
 * screen triangle `(s0,s1,s2)`, of vertex coordinates `uva..uvc` and clip `1/w` `iw`: the
 * derivatives a fragment reads, exact at the pixel. Zero for a degenerate triangle. The one
 * formula of the resolve (`shadeWgsl.ts`) and of the compute raster's cutout
 * (`../../gpu/raster/pixelWgsl.ts`); `uvDerivatives` (`../math.ts`) is its CPU mirror.
 */
export const UV_GRADIENTS_WGSL = `fn uvGradients(s0:vec2f,s1:vec2f,s2:vec2f,p:vec2f,uva:vec2f,uvb:vec2f,uvc:vec2f,iw:vec3f)->mat2x2f{
 let dxb=s1.x-s0.x;let dyb=s1.y-s0.y;let dxc=s2.x-s0.x;let dyc=s2.y-s0.y;let det=dxb*dyc-dxc*dyb;
 if(det==0.0){return mat2x2f(vec2f(0.0),vec2f(0.0));}
 let inv=1.0/det;let dsdx=dyc*inv;let dsdy=-dxc*inv;let dtdx=-dyb*inv;let dtdy=dxb*inv;
 let s=((p.x-s0.x)*dyc-(p.y-s0.y)*dxc)*inv;let t=((p.y-s0.y)*dxb-(p.x-s0.x)*dyb)*inv;let a0=1.0-s-t;
 let iw0=iw.x;let iw1=iw.y;let iw2=iw.z;
 let U=a0*uva*iw0+s*uvb*iw1+t*uvc*iw2;let W=a0*iw0+s*iw1+t*iw2;
 if(W==0.0){return mat2x2f(vec2f(0.0),vec2f(0.0));}
 let dUds=-uva*iw0+uvb*iw1;let dUdt=-uva*iw0+uvc*iw2;let dWds=-iw0+iw1;let dWdt=-iw0+iw2;
 let dUdx=dUds*dsdx+dUdt*dtdx;let dUdy=dUds*dsdy+dUdt*dtdy;let dWdx=dWds*dsdx+dWdt*dtdx;let dWdy=dWds*dsdy+dWdt*dtdy;
 return mat2x2f((dUdx*W-U*dWdx)/(W*W),(dUdy*W-U*dWdy)/(W*W));
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
 * pixel or shadow texel —: each reads the map at the level of its footprint (`maskAlpha`,
 * `../../webgpu/tile/wgsl.ts`), the camera through the colour's own read. This is the only cutout of
 * an opaque pixel: the resolve shades what the raster kept and never tests again. The compute
 * raster has no derivatives: on an accumulating image it passes the exact screen gradients of its
 * perspective-correct coordinate (`uvGradients`, as the resolve), otherwise zero
 * and reads level 0 — the finest resident tile under that texel.
 *
 * `stipple` (`stippleOffset`, in (−½, ½)) moves the threshold of an accumulating camera pixel by
 * up to half the alpha a pixel spans. A minified texel is an aggregate of the finer ones, and a
 * hard threshold turns what it covers into all or nothing: the thin branches of a canopy vanish
 * as it recedes. Under the stipple, the pixel is kept on the share of the temporal cycle that
 * its alpha passes, and the temporal pass averages that share back into partial coverage. The
 * spread is the footprint's level above the finest, clamped to one: zero while a texel covers a
 * pixel or more — there the jitter already antialiases the edge, and the test stays the hard one
 * — and the whole alpha range once the read comes from coarser levels. Both rasters stipple the
 * same way. The shadows, which no temporal pass averages, pass zero: their test is the hard
 * threshold, to the bit.
 *
 * `vertexAlpha` is the interpolated alpha of the vertex colours (`pageMaskAlpha`), one on a row
 * that reads none: the reference multiplies the diffuse alpha by it before its alpha test.
 * Shadows pass one, as the reference's depth material reads no vertex colour.
 *
 * The host shader declares `uvs`, the colour pool and its page table, then inserts
 * `TILE_POOL_WGSL` (which carries the addressing rule), `COLOR_SAMPLE_WGSL` and
 * `maskAlphaWgsl(...)` before this block.
 */
export const MASK_KEEP_WGSL = `fn maskKeep(page:PageInfo,uv:vec2f,vertexAlpha:f32,ddx:vec2f,ddy:vec2f,stipple:f32)->bool{
 if((page.flags&128u)==0u){return true;}
 // A row that reads no colour is cut by its base map alone, never by an interpolated one, which
 // need not round back to one exactly.
 let coloured=(page.flags&${FLAG_HAS_COLOR}u)!=0u;
 if((page.flags&8u)==0u){return !coloured||vertexAlpha>=page.baseColor.w;}
 // Levels of the chain take the MEDIAN of alpha, never its mean: a coarse texel passes the
 // threshold when half of what it covers passed it, so threshold coverage crosses the levels and
 // the cutout stays right at every level. A mean, itself, made the silhouette grow level after
 // level and made the quad opaque during loading.
 var alpha=maskAlpha(page.mapIndex,uv,ddx,ddy,(page.flags&${FLAG_SAMPLED}u)!=0u);
 if(coloured){alpha*=vertexAlpha;}
 if(stipple==0.0){return alpha>=page.baseColor.w;}
 let size=colorSlot(page.mapIndex).size;
 return alpha>=page.baseColor.w+stipple*saturate(atlasLod(ddx*size,ddy*size));
}`;

/**
 * Threshold offset of the cutout stipple at a camera pixel, in (−½, ½), or zero when the image
 * does not accumulate — then `maskKeep` is the hard threshold. A 4×4 ordered (Bayer) pattern
 * spreads sixteen neighbouring pixels over one step of the temporal rank, and the
 * ${TAA_SAMPLES} ranks of the jitter cycle walk each pixel through ${TAA_SAMPLES} evenly spaced
 * thresholds: a still image, the uniform average of whole cycles, holds each pixel's exact share.
 * The temporal pass needs nothing more: a partly covered 4×4 pattern puts both states inside the
 * 3×3 neighbour box it clamps history to (`../../taa/shaderWgsl.ts`). Requires `uni`.
 */
export const STIPPLE_WGSL = `fn stippleOffset(pixel:vec2f)->f32{
 if(uni.stipple==0u){return 0.0;}
 let p=vec2u(pixel)&vec2u(3u);let v=p.x^p.y;
 let bayer=((v&1u)<<3u)|((p.y&1u)<<2u)|(v&2u)|((p.y&2u)>>1u);
 return (f32(uni.stipple-1u)+(f32(bayer)+0.5)/16.0)/${TAA_SAMPLES}.0-0.5;
}`;
