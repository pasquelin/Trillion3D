/**
 * Step 5, raster half: the non-cluster VSM depth draw, drawn per (caster row, page) pair
 * (`renderCullWgsl.ts` `vsmRenderExpand`) into a 128×128 dummy attachment: WebGPU has no
 * 16384-wide viewport without a 16384² attachment, so the vertex shader maps the pair's virtual
 * page onto the whole viewport (the same pixel centres as a virtual raster: page offsets are whole
 * pixels) and the fragment adds the physical page origin (flat varying) before the 32-bit
 * `atomicMax` into `pool[physical texel, slice]`. A triangle over four pages is drawn four times,
 * once per pair. The page clip (clip distances to the uncached rect) is the pair's page itself.
 *
 * One non-indexed `drawIndirect` per chunk (vertex pulling): `vertex_index` is the corner of the
 * row (`PageInfo.indexCount`, the chunk's draw counts the largest), `instance_index` the pair;
 * corners past a row's own and culled triangles output a NaN position.
 *
 * Face culling: the mesh's cull mode is applied for VSM (two-sided → none, VSM never reverses).
 * Here it is decided per triangle in the vertex shader, in world space, the camera's convention: a
 * triangle is front when its counter-clockwise normal (flipped by a mirroring placement, the main
 * raster's `windingCw`) faces the light — toward −light-direction for an orthographic view (the
 * reversed-Z clip z gradient), toward the light position (the shifted origin) for a
 * perspective one. Double-sided rows (`FLAG_DOUBLE`) cull nothing, back-side rows (`FLAG_BACK`)
 * cull the front.
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
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { matrixWindingCw } from '../../../math/src/wgsl/matrix.ts'
import { PAGE_GEOMETRY_WGSL, UV_READ } from '../visibility/shader/pageGeometryWgsl.ts'
import { MASK_KEEP_WGSL, PAGE_BINDING, PAGE_INFO_WGSL } from '../visibility/shader/pageWgsl.ts'
import { FLAG_BACK, FLAG_DOUBLE, FLAG_MASK } from '../visibility/types.ts'
import { VIS_BINDINGS } from '../webgpu/core/bindLayout.ts'
import {
  COLOR_SAMPLE_WGSL,
  maskAlphaWgsl,
  tileDeclarations,
  tilePoolWgsl,
} from '../webgpu/tile/wgsl.ts'
import { VSM_CONSTANTS_WGSL, VSM_F32_BELOW_ONE } from './constants.ts'
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
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
${tileDeclarations(VIS_BINDINGS.color, 'color')}
@group(0) @binding(${VIS_BINDINGS.sampler}) var mapsSampler:sampler;
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
/** World position of a row's vertex, composed as the shadow depth pass composes it. */
fn vsmRenderWorld(page:PageInfo,h:ClusterHeader,vertex:u32)->vec3f{return (page.world*vec4f(pagePosition(page,h,vertex),1.0)).xyz;}
/** Whether the mesh cull mode keeps triangle (a,b,c) seen from the VSM view \`raw\`. */
fn vsmRenderFaceKept(page:PageInfo,raw:VsmProjectionRecord,a:vec3f,b:vec3f,c:vec3f,twA:vec3f)->bool{
 if((page.flags&${FLAG_DOUBLE}u)!=0u){return true;}
 let w=page.world;
 let mirrored=matrixWindingCw(w);
 var n=cross(b-a,c-a);
 if(mirrored){n=-n;}
 let uv=raw.shiftedToMapUv;
 let isOrtho=raw.lightViewToClip[3][3]>=1.0;
 // Toward the light: the clip z gradient (reversed Z, nearer = larger) for an orthographic view,
 // the shifted origin (originShift = −light position) for a perspective one.
 let toLight=select(-twA,vec3f(uv[0].z,uv[1].z,uv[2].z),isOrtho);
 let front=dot(n,toLight)>0.0;
 let back=(page.flags&${FLAG_BACK}u)!=0u;
 return select(front,!front,back);
}
@vertex fn vsmRenderVs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instanceIndex:u32)->VsmRenderOut{
 let pair=vsmRenderPairs[instanceIndex];
 var out:VsmRenderOut;
 out.row=pair.x;out.uv=vec2f(0.0);out.dest=vec2u(pair.w,(pair.y>>21u)&1u);out.fromEmitter=vec4f(0.0);
 let page=pages[pair.x];
 out.masked=page.flags&${FLAG_MASK}u;
 if(vertexIndex>=page.indexCount){out.position=vsmRenderNan();return out;}
 let raw=vsmProjectionData[pair.y&0xFFFFu];
 let h=pageHeaderFor(page,pageSurfaceRead(page));
 let tri=pageTriangle(page,h,vertexIndex/3u);
 let corner=vertexIndex%3u;
 let a=vsmRenderWorld(page,h,tri.x);
 let b=vsmRenderWorld(page,h,tri.y);
 let c=vsmRenderWorld(page,h,tri.z);
 let shiftHigh=raw.originShiftHigh;let shiftLow=raw.originShiftLow;
 if(!vsmRenderFaceKept(page,raw,a,b,c,(a+shiftHigh)+shiftLow)){out.position=vsmRenderNan();return out;}
 let id=select(select(tri.z,tri.y,corner==1u),tri.x,corner==0u);
 let world=select(select(c,b,corner==1u),a,corner==0u);
 // Translated world of the VSM view, then its clip.
 let shifted=(world+shiftHigh)+shiftLow;
 let isOrthoView=raw.lightViewToClip[3][3]>=1.0;
 out.fromEmitter=vec4f(shifted,select(raw.emitterSize,0.0,isOrthoView));
 let uvH=raw.shiftedToMapUv*vec4f(shifted,1.0);
 var z=uvH.z;var w=uvH.w;
 // A sun level's caster in front of its near plane is flattened onto it: the vertex takes the
 // greatest depth an f32 holds below 1, 1 − 2^-24, the nearest the clip volume (z ≤ w, w = 1)
 // keeps strictly inside, so that no rounding of the clip test drops it. Every receiver of the
 // level lies at a depth of at most 1 behind it.
 if(((pair.y>>20u)&1u)!=0u&&z>w){z=${VSM_F32_BELOW_ONE};w=1.0;}
 // Clip scaled and biased onto the pair's page: virtual pixel x = u·W over the mip
 // (W = 16384 >> mip), page-local NDC over the 128-pixel viewport.
 let mipLevel=(pair.y>>16u)&7u;
 let s=f32(VSM_LEVEL0_TEXELS>>mipLevel)/f32(VSM_PAGE_TEXELS/2u);
 let vPage=vec2f(f32(pair.z&0xFFu),f32((pair.z>>8u)&0xFFu));
 out.position=vec4f(uvH.x*s-w*(2.0*vPage.x+1.0),w*(2.0*vPage.y+1.0)-uvH.y*s,z,w);
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
 vsmPoolAtomicMax(texel,in.dest.y,bitcast<u32>(clamp(in.position.z,0.0,1.0)));
}
`,
    [
      PAGE_INFO_WGSL,
      tilePoolWgsl('0.0'),
      COLOR_SAMPLE_WGSL,
      maskAlphaWgsl(true),
      MASK_KEEP_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_VERTEX_SPECS, layout),
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_FRAGMENT_SPECS, layout),
      matrixWindingCw,
      PAGE_GEOMETRY_WGSL,
    ],
  )
