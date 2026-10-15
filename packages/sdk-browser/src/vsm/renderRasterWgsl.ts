/**
 * Step 5, raster half: the non-cluster VSM depth draw, drawn per (caster row, page) pair
 * (`renderCullWgsl.ts` `vsmRenderExpand`) into a 128×128 dummy attachment: WebGPU has no
 * 16384-wide viewport without a 16384² attachment, so the vertex shader maps the pair's virtual
 * page onto the whole viewport (the same pixel centres as a virtual raster: page offsets are whole
 * pixels) and the fragment adds the physical page origin (flat varying) before the 32-bit
 * `atomicMax` into `pool[physical texel, slice]` — a static caster's into slice 0 as well. A
 * triangle over four pages is drawn four times,
 * once per pair. The page clip (clip distances to the uncached rect) is the pair's page itself.
 *
 * One non-indexed `drawIndirect` per chunk (vertex pulling): `vertex_index` is the corner of the
 * row (`PageInfo.indexCount`, the chunk's draw counts the largest), `instance_index` the pair;
 * corners past a row's own and culled triangles output a NaN position.
 *
 * Face culling: the mesh's cull mode, by the rasterizer (`cullMode: 'back'`, `frontFace: 'ccw'`): each
 * vertex emits its triangle in the winding that makes a face toward the light counter-clockwise on
 * the framebuffer (`vsmRenderEmitsSwapped`): a counter-clockwise world normal, turned by a mirroring
 * placement (the main raster's `windingCw`) and by a back-side row (`FLAG_BACK`, which keeps its back
 * faces), against the map's own handedness. A two-sided row (`FLAG_DOUBLE`) draws its corners twice,
 * the second time swapped: one of the two copies faces the light. A vertex decodes its own corner
 * alone.
 *
 * Emitter envelope: a local light that declares an emitter radius (`emitterSize`, the
 * scene light's `emitterRadius`) accepts no depth from inside that sphere — the bulb, the glass or
 * the shade that wraps it never shadows its own light (the engine's light contract). A local view's
 * shifted position is relative to the light, so the test is |shifted|² < r².
 *
 * Masked materials keep the engine's cutout (`maskKeep`, the depth material's clip) at the VSM
 * texel's derivatives; an unmasked row, which `maskKeep` keeps whole, is told by a flat word and
 * reads no page. The depth itself is the fragment position z (= z/w), clamped to [0,1] before the
 * bitcast, and joins the pool's word only where it is greater (`vsmPoolAtomicMax`).
 *
 * Group 0 = the engine's shadow page group (`webgpu/shadow/pageGroup.ts`, the visibility layout
 * less flags / uniform / instances / slot offsets). Group 1: 0 pairs (vertex), 1 projection
 * data (vertex), 2.. pool slices × parts (fragment, atomic).
 */
import { VSM_CASTER_PROJECTION_WGSL } from './renderCasterWgsl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { bitAt, bitIsSet, byteOf } from '../../../math/src/wgsl/integer.ts'
import { matrixWindingCw } from '../../../math/src/wgsl/matrix.ts'
import { PAGE_GEOMETRY_WGSL, UV_READ } from '../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_BINDING, PAGE_INFO_WGSL, maskKeepWgsl } from '../visibility/shader/pageWgsl.ts'
import { FLAG_BACK, FLAG_DOUBLE, FLAG_MASK } from '../visibility/types.ts'
import {
  colorSampleWgsl,
  maskAlphaWgsl,
  SHADOW_TILE_POOL_WGSL,
  materialDeclarations,
} from '../webgpu/tile/wgsl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import type { VsmLayout } from './layout.ts'

/** Group 1 of the raster: projection data (vertex) at 1, the pool (fragment, atomic) from 2. */
export const VSM_RENDER_RASTER_VERTEX_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'projectionData', binding: 1 },
]
export const VSM_RENDER_RASTER_FRAGMENT_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'pagePool', binding: 2, access: 'atomic' },
]
/** The dummy attachment: one page. */
export const VSM_RENDER_TARGET_FORMAT: GPUTextureFormat = 'depth16unorm'

export const vsmRenderRasterWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${materialDeclarations()}
@group(1) @binding(0) var<storage,read> vsmRenderPairs:array<vec4u>;
struct VsmRenderOut{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) row:u32,
 @location(1) uv:vec2f,
 /** Physical page address (x | y << 10) and pool slice. */
 @location(2) @interpolate(flat) dest:vec2u,
 /** Translated world (relative to a local light) and the emitter radius, 0 for none. */
 @location(3) fromEmitter:vec4f,
 /** Whether the row is masked (\`maskKeep\` keeps every fragment of another). */
 @location(4) @interpolate(flat) masked:u32,
}
/** A dropped corner: every corner of a dropped triangle lands on this one point outside the
 *  viewport, a zero-area triangle no rasterizer covers (a NaN constant does not compile in Tint). */
fn vsmRenderNan()->vec4f{return vec4f(-4.0,-4.0,0.5,1.0);}
/**
 * Whether a vertex emits its triangle with corners 1 and 2 swapped, so that a face toward the light
 * is counter-clockwise on the framebuffer. A triangle's projected winding is its facing times the
 * sign of D: for a perspective map, D = −det of the UV matrix's u, v, w rows (the light at the
 * shifted origin, those rows linear), for an orthographic one det of its u, v, z rows (z toward the
 * light, reversed Z); the page's NDC y and the framebuffer's y each turn it once. Swapped where D < 0,
 * where a mirroring placement turns the counter-clockwise normal, where a back-side row keeps its back
 * faces, and for a two-sided row's second copy.
 */
fn vsmRenderEmitsSwapped(page:PageInfo,raw:VsmProjectionRecord,second:bool)->bool{
 let m=raw.shiftedToMapUv;
 let ortho=raw.lightViewToClip[3][3]>=1.0;
 let r3=select(vec3f(m[0].w,m[1].w,m[2].w),vec3f(m[0].z,m[1].z,m[2].z),ortho);
 let d=dot(vec3f(m[0].x,m[1].x,m[2].x),cross(vec3f(m[0].y,m[1].y,m[2].y),r3));
 let negative=select(d>0.0,d<0.0,ortho);
 return negative!=(matrixWindingCw(page.world)!=(((page.flags&${FLAG_BACK}u)!=0u)!=second));
}
@vertex fn vsmRenderVs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VsmRenderOut{
 let pair=vsmRenderPairs[instanceIndex];
 var out:VsmRenderOut;
 out.row=pair.x;out.uv=vec2f(0.0);out.dest=vec2u(pair.w,bitAt(pair.y,21u));out.fromEmitter=vec4f(0.0);
 let page=pages[pair.x];
 out.masked=page.flags&${FLAG_MASK}u;
 let n=page.indexCount;
 let second=vertexIndex>=n;
 if(vertexIndex>=select(n,2u*n,(page.flags&${FLAG_DOUBLE}u)!=0u)){out.position=vsmRenderNan();return out;}
 let v=select(vertexIndex,vertexIndex-n,second);
 let raw=vsmProjectionData[pair.y&0xFFFFu];
 let h=pageHeaderFor(page,pageSurfaceRead(page));
 let tri=pageTriangle(page,h,v/3u);
 var corner=v%3u;
 if(corner!=0u&&vsmRenderEmitsSwapped(page,raw,second)){corner=3u-corner;}
 let id=select(select(tri.z,tri.y,corner==1u),tri.x,corner==0u);
 let world=vsmRenderWorld(page,h,id);
 // Translated world of the VSM view, then its clip.
 let shifted=vsmRenderShifted(raw,world);
 let isOrthoView=raw.lightViewToClip[3][3]>=1.0;
 out.fromEmitter=vec4f(shifted,select(raw.emitterSize,0.0,isOrthoView));
 let clip=vsmRenderClip(raw,shifted,bitIsSet(pair.y,20u));
 // Clip scaled and biased onto the pair's page: virtual pixel x = u·W over the mip
 // (W = 16384 >> mip), page-local NDC over the 128-pixel viewport.
 let mipLevel=(pair.y>>16u)&7u;
 let s=f32(VSM_LEVEL0_TEXELS>>mipLevel)/f32(VSM_PAGE_TEXELS/2u);
 let vPage=vec2f(f32(byteOf(pair.z,0u)),f32(byteOf(pair.z,1u)));
 out.position=vec4f(clip.x*s-clip.w*(2.0*vPage.x+1.0),clip.w*(2.0*vPage.y+1.0)-clip.y*s,clip.z,clip.w);
 // The fragment's cutout reads the UV of a masked row alone (\`maskKeep\`).
 if((page.flags&${UV_READ}u)==${UV_READ}u){out.uv=pageUv(page,h,id);}
 return out;
}
/** The depth fragment: the emitter envelope and the material clip of a masked row, then an
 *  atomic max into the pool. */
@fragment fn vsmRenderFs(in:VsmRenderOut){
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 let r=in.fromEmitter.w;
 let onEmitter=r>0.0&&dot(in.fromEmitter.xyz,in.fromEmitter.xyz)<r*r;
 if(onEmitter||(in.masked!=0u&&!maskKeep(pages[in.row],in.uv,1.0,gx,gy))){discard;}
 let physical=vec2u(in.dest.x&0x3FFu,(in.dest.x>>10u)&0x3FFu);
 let texel=physical*VSM_PAGE_TEXELS+min(vec2u(in.position.xy),vec2u(VSM_PAGE_TEXEL_MASK));
 let depth=bitcast<u32>(clamp(in.position.z,0.0,1.0));
 vsmPoolAtomicMax(texel,in.dest.y,depth);
 // A static caster draws a page whose static layer is drawn again this frame, whose dynamic layer
 // (slice 0, what every reader samples) was cleared with it: it joins slice 0 too, which holds
 // then both layers once the dynamic casters drew theirs — no merge after the raster.
 if(in.dest.y!=0u){vsmPoolAtomicMax(texel,0u,depth);}
}
`,
    [
      PAGE_INFO_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      SHADOW_TILE_POOL_WGSL,
      colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
      maskKeepWgsl(maskAlphaWgsl(true, SHADOW_TILE_POOL_WGSL)),
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_VERTEX_SPECS, layout),
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_FRAGMENT_SPECS, layout),
      PAGE_GEOMETRY_WGSL,
      byteOf,
      bitAt,
      bitIsSet,
    ],
  )
