/**
 * THE SHADOW RASTER'S DRAW: the records the cull emitted, sorted by tier (`renderBinWgsl.ts`), drawn
 * by the hardware raster a window at a time, as the reference's hardware raster draws a visible
 * cluster over its raster window: a viewport of `VSM_RENDER_WINDOW_PAGES` pages a side, the record's
 * first page at its corner, into a dummy attachment of that size
 * (`renderTarget`): WebGPU has no 16384-wide viewport without a 16384² attachment. Each fragment finds
 * its page of the window and translates its pixel through the page table, drawn only on a page the
 * record draws and a page to draw, then joins the pool by a 32-bit
 * `atomicMax` — a static caster's into slice 0 as well.
 *
 * One non-indexed `drawIndirect` per corner tier (vertex pulling, `vsmRenderArgsBin`): a tier's
 * pipeline draws `VSM_RENDER_CORNERS` corners a record (an override), vertex k of record p being
 * `vertex_index` p · corners + k of one instance; corners past a row's own and the corners of a
 * tessellated record (bit 23) output a point no rasterizer covers.
 *
 * Face culling: the mesh's cull mode, by the rasterizer (`cullMode: 'back'`, `frontFace: 'ccw'`): each
 * vertex emits its triangle in the winding that makes a face toward the light counter-clockwise on
 * the framebuffer, the record's swapped bit (`vsmRenderSwapped`, decided once a candidate and map by
 * the cull). A two-sided row (`FLAG_DOUBLE`) is in a tier of its own family (`vsmRenderTierOf`),
 * whose pipelines cull no face (`cullMode: 'none'`): its corners are drawn once, in either winding.
 * A vertex decodes its own corner alone.
 *
 * Depth: a clipmap level has no near clip (`vsmRecordNoNearClip`): its vertex hands the rasterizer
 * z = w / 2, so that the hardware never clips on depth, and the map's own clip position in `clip`;
 * the fragment's depth is the interpolated ratio of its z and w, clamped to [0,1].
 *
 * Masked materials keep the engine's cutout (`maskKeep`, the depth material's clip) at the VSM
 * texel's derivatives, its dither at the map's own pixel (`vsmRenderMapPixel`), whatever page holds
 * the texel; an unmasked row, which `maskKeep` keeps whole, is told by a flat word and reads no page. The depth itself is the interpolated clip z / w, clamped to [0,1] before the
 * bitcast, and joins the pool's word only where it is greater (`vsmPoolAtomicMax`). A masked row is
 * tested against the depth the pool already holds before its cutout is evaluated
 * (`vsmRenderBeats`): a fragment that cannot win evaluates no material.
 *
 * Group 0 = the engine's shadow page group (`lighting/shadows/casters/pageGroup.ts`, the visibility
 * layout less flags / uniform / instances / slot offsets). Group 1: 0 the sorted records (vertex),
 * 1 projection data (vertex), 2.. pool slices (fragment, atomic), then the page table (fragment) and
 * the uniforms (both stages).
 */
import { VSM_CASTER_PROJECTION_WGSL } from './renderCasterWgsl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { PAGE_GEOMETRY_WGSL, UV_READ } from '../../../../visibility/shader/pageGeometryWgsl.ts'
import { maskUvWgsl } from '../../../../visibility/shader/pageUvSetWgsl.ts'
import { VIS_BINDINGS } from '../../../../gpu/bind/bindLayout.ts'
import {
  PAGE_BINDING,
  PAGE_INFO_WGSL,
  maskKeepWgsl,
} from '../../../../visibility/shader/pageWgsl.ts'
import { FLAG_MASK } from '../../../../visibility/types.ts'
import {
  colorSampleWgsl,
  maskAlphaWgsl,
  SHADOW_TILE_POOL_WGSL,
  materialDeclarations,
} from '../../../../materials/virtual/wgsl.ts'
import { VSM_CONSTANTS_WGSL, VSM_PAGE_TEXELS } from '../constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_TABLE_ORIGIN_WGSL } from '../pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { NO_MASKS, maskKnowsPixel, type MaskSet } from '../../../../materials/graph/maskProgram.ts'
import { NO_WPO, type WpoSet } from '../../../../materials/graph/wpoProgram.ts'
import { wpoGraphWgsl } from '../../../../visibility/shader/wpoGraphWgsl.ts'
import { VSM_RENDER_RECORD_WGSL, VSM_RENDER_WINDOW_PAGES } from './renderParamsWgsl.ts'

/** Group 1 of the raster: projection data (vertex) at 1, the pool (fragment, atomic) from 2, the
 *  page table (fragment) after it, the uniforms (both stages) last. */
export const VSM_RENDER_RASTER_VERTEX_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'projectionData', binding: 1 },
]
export const VSM_RENDER_RASTER_FRAGMENT_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'pagePool', binding: 2, access: 'atomic' },
  { resource: 'pageTable', binding: 4 },
]
export const VSM_RENDER_RASTER_SHARED_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 5 },
]
/** The dummy attachment: one window. */
export const VSM_RENDER_TARGET_FORMAT: GPUTextureFormat = 'depth16unorm'
export const VSM_RENDER_TARGET_TEXELS = VSM_RENDER_WINDOW_PAGES * VSM_PAGE_TEXELS

/** A clip position on the map placed on a record's window (`vsmRenderWindowAt`): the hardware
 *  raster's, `VSM_RENDER_WINDOW_PAGES` pages a side, and the software raster's, one page
 *  (`renderSoftwareWgsl.ts`). */
export const VSM_RENDER_WINDOW_WGSL = wgslBlock(
  'VSM_RENDER_WINDOW_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_RENDER_RECORD_WGSL],
  `/** A clip position on the map placed on record \`r\`'s window of \`side\` pages a side: the virtual
 *  pixel of its mip, its first page at the viewport's corner. */
fn vsmRenderWindowAt(clip:vec4f,r:vec4u,side:u32)->vec4f{
 let s=f32(VSM_LEVEL0_TEXELS>>vsmRecordMip(r))/f32(side*VSM_PAGE_TEXELS/2u);
 let first=vec2f(vsmRecordFirstPage(r))*(2.0/f32(side));
 return vec4f(clip.x*s-clip.w*(first.x+1.0),clip.w*(first.y+1.0)-clip.y*s,clip.z,clip.w);
}
/** The hardware raster's window: \`VSM_RENDER_WINDOW_PAGES\` pages a side. */
fn vsmRenderWindowPosition(clip:vec4f,r:vec4u)->vec4f{return vsmRenderWindowAt(clip,r,${VSM_RENDER_WINDOW_PAGES}u);}
/** The position the hardware raster is given for a clip position: its window position, at z = w / 2
 *  for a record with no near clip (\`vsmRecordNoNearClip\`), so that no depth clips it. */
fn vsmRenderRasterPosition(clip:vec4f,r:vec4u)->vec4f{
 let p=vsmRenderWindowPosition(clip,r);
 return select(p,vec4f(p.xy,0.5*p.w,p.w),vsmRecordNoNearClip(r));
}
/** The map's own pixel at mip \`mip\` of a clip position on the map (before \`vsmRenderRasterPosition\`
 *  places it on a window): the position a masked caster's dither is anchored on, whatever page holds
 *  the texel. */
fn vsmRenderMapPixel(clip:vec4f,mip:u32)->vec2f{
 let ndc=clip.xy/clip.w;
 let size=f32(VSM_LEVEL0_TEXELS>>mip);
 return vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5)*(size-1.0)+0.5;
}`,
)

/** What a vertex stage hands the depth fragment (`vsmRenderFs`), the tiers' and the tessellated
 *  patches' (`../tessellation/shadowRasterWgsl.ts`) alike, the position a dropped corner takes, the
 *  placing of a clip position on a record's window and the window as the fragment reads it. */
export const VSM_RENDER_OUT_WGSL = wgslBlock(
  'VSM_RENDER_OUT_WGSL',
  [
    VSM_CONSTANTS_WGSL,
    VSM_HANDLE_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_TABLE_ORIGIN_WGSL,
    VSM_RENDER_RECORD_WGSL,
    VSM_RENDER_WINDOW_WGSL,
  ],
  `struct VsmRenderOut{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) row:u32,
 @location(1) uv:vec2f,
 /** The window (\`vsmRenderWindowOf\`). */
 @location(2) @interpolate(flat) window:vec4u,
 /** The map's clip position, before it is placed on the window: its z / w is the depth, its x and y
  *  the map's pixel (\`vsmRenderMapPixel\`). */
 @location(3) clip:vec4f,
 /** Whether the row is masked (\`maskKeep\` keeps every fragment of another). */
 @location(4) @interpolate(flat) masked:u32,
}
/** A dropped corner: every corner of a dropped triangle lands on this one point outside the
 *  viewport, a zero-area triangle no rasterizer covers (a NaN constant does not compile in Tint). */
fn vsmRenderNan()->vec4f{return vec4f(-4.0,-4.0,0.5,1.0);}
/** The window record \`r\` draws, as its fragment reads it: the page table's index of its first page,
 *  its pages and the pages it draws (the record's z and w), whether it draws the static layer (bit 0)
 *  and its mip (the bits above). */
fn vsmRenderWindowOf(r:vec4u)->vec4u{
 let mip=vsmRecordMip(r);
 let cell=vsmTableEntryAt(vsmTableLevelOrigin(vsmHandleFromId(vsmRecordMap(r)),mip),mip,vsmRecordFirstPage(r));
 return vec4u(vsmTableIndex(cell.tableXY),r.z,r.w,vsmRecordStatic(r)|(mip<<1u));
}
/** The mip of a window (\`vsmRenderWindowOf\`). */
fn vsmRenderWindowMip(window:vec4u)->u32{return window.w>>1u;}
`,
)

/** The word a depth \`z\` joins the pool as: clamped to [0,1], its bits, which order as the floats do
 *  (non-negative): the hardware fragment's (\`vsmRenderJoin\`) and the software raster's. And whether
 *  that word can join the pool at \`texel\` of \`slice\`: it is greater than the word already held, the
 *  only depth the join writes (\`vsmPoolAtomicMax\`). A word only grows, so a depth that cannot win now
 *  never will: a masked row asks before it evaluates its cutout. */
export const VSM_RENDER_DEPTH_WGSL = wgslBlock(
  'VSM_RENDER_DEPTH_WGSL',
  [],
  `fn vsmRenderDepth(z:f32)->u32{return bitcast<u32>(clamp(z,0.0,1.0));}
fn vsmRenderBeats(texel:vec2u,slice:u32,depth:u32)->bool{return depth>vsmPoolLoad(texel,slice);}
`,
)

/** The fragment's half of the window: a pixel's pool texel and the join of its depth. */
export const VSM_RENDER_JOIN_WGSL = wgslBlock(
  'VSM_RENDER_JOIN_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_RENDER_RECORD_WGSL, VSM_RENDER_DEPTH_WGSL],
  `/** The pool texel of pixel \`pixel\` of \`window\` (\`vsmRenderWindowOf\`), through the page table: none
 *  (false) where the record does not draw the pixel's page or the page is not one to draw. */
fn vsmRenderPoolTexel(window:vec4u,pixel:vec2f,texel:ptr<function,vec2u>)->bool{
 let p=vec2u(pixel);
 let local=p>>vec2u(VSM_LOG2_PAGE);
 if(!vsmRecordDrawsPage(vec4u(0u,0u,window.y,window.z),local)){return false;}
 let entry=vsmUnpackTableEntry(vsmPageTableLoad(window.x+local.y*vsm.pageTableSize.x+local.x));
 if(!entry.thisLevelDrawable){return false;}
 *texel=entry.physicalAddress*VSM_PAGE_TEXELS+(p&vec2u(VSM_PAGE_TEXEL_MASK));
 return true;
}
/** The slice of the pool the window's layer joins its depths to (\`staticSlice\` for the static layer):
 *  a static caster writes the static slice alone; the pages that drew it merge it into slice 0, what
 *  every reader samples, after the raster (\`vsmMergePages\`). */
fn vsmRenderSlice(window:vec4u)->u32{return select(0u,vsm.staticSlice,(window.w&1u)!=0u);}
/** The word \`depth\` (\`vsmRenderDepth\`) joined to the pool at \`texel\`, in the window's layer's slice. */
fn vsmRenderJoin(window:vec4u,texel:vec2u,depth:u32){
 vsmPoolAtomicMax(texel,vsmRenderSlice(window),depth);
}
`,
)

const renderRasterVertex = (wpo: WpoSet) => /* wgsl */ `${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${materialDeclarations()}
@group(1) @binding(0) var<storage,read> vsmRenderRecords:array<vec4u>;
/** The corners a record of this pipeline's tier draws (\`VSM_RENDER_TIER_CORNERS << tier\`). */
override VSM_RENDER_CORNERS:u32=96u;
@vertex fn vsmRenderVs(@builtin(vertex_index) vertexIndex:u32)->VsmRenderOut{
 let record=vsmRenderRecords[vertexIndex/VSM_RENDER_CORNERS];
 let recordCorner=vertexIndex%VSM_RENDER_CORNERS;
 var out:VsmRenderOut;
 out.row=record.x;out.uv=vec2f(0.0);out.window=vsmRenderWindowOf(record);out.clip=vec4f(0.0);
 // A tessellated record's triangles are not drawn: its patches are (\`vsmTessellatedVs\`).
 if(vsmRecordTessellated(record)){out.position=vsmRenderNan();return out;}
 let page=pages[record.x];
 out.masked=page.flags&${FLAG_MASK}u;
 if(recordCorner>=page.indexCount){out.position=vsmRenderNan();return out;}
 let raw=vsmProjectionData[vsmRecordMap(record)];
${wpo.programs.length ? ' // The map decides whether the offset of an object is drawn in it (`wpoAllowed`).\n wpoThreshold=raw.wpoThreshold;\n' : ''} let h=pageHeaderFor(page,pageSurfaceRead(page));
 let tri=pageTriangle(page,h,recordCorner/3u);
 var corner=recordCorner%3u;
 if(corner!=0u&&vsmRecordSwapped(record)){corner=3u-corner;}
 let id=select(select(tri.z,tri.y,corner==1u),tri.x,corner==0u);
 let world=vsmRenderWorld(page,h,id);
 // Translated world of the VSM view, then its clip, placed on the record's window.
 let shifted=vsmRenderShifted(raw,world);
 let clip=vsmRenderClip(raw,shifted);
 out.position=vsmRenderRasterPosition(clip,record);out.clip=clip;
 // The fragment's cutout reads the UV of a masked row alone (\`maskKeep\`).
 if((page.flags&${UV_READ}u)==${UV_READ}u){out.uv=pageMaskUv(page,h,id);}
 return out;
}`

const renderRasterFragment = (masks: MaskSet) => /* wgsl */ `
/** The depth fragment: its page and pool texel and the material clip of a masked row, then an atomic
 *  max into the pool. */
@fragment fn vsmRenderFs(in:VsmRenderOut){
 let gx=dpdx(in.uv);let gy=dpdy(in.uv);
 var texel:vec2u;
 if(!vsmRenderPoolTexel(in.window,in.position.xy,&texel)){discard;}
 let depth=vsmRenderDepth(in.clip.z/in.clip.w);
 // A masked row evaluates its cutout only for a depth that can win.
 if(in.masked!=0u&&!vsmRenderBeats(texel,vsmRenderSlice(in.window),depth)){discard;}
 if(in.masked!=0u&&!${
   maskKnowsPixel(masks)
     ? 'maskKeepAt(pages[in.row],in.uv,1.0,gx,gy,vsmRenderMapPixel(in.clip,vsmRenderWindowMip(in.window)))'
     : 'maskKeep(pages[in.row],in.uv,1.0,gx,gy)'
 }){discard;}
 vsmRenderJoin(in.window,texel,depth);
}`

/** The depth fragment and vertex of the casters' draw; a surface whose graph wires an `opacityMask` is
 *  cut by the graph's mask at the texel (`masks`), dithered where its surface asks (`maskKeepAt`, at
 *  the map's virtual pixel), and one that wires a `worldPositionOffset` casts the shadow of the
 *  vertices it moves (`wpo`). */
export const vsmRenderRasterWgsl = (
  layout: VsmLayout,
  masks: MaskSet = NO_MASKS,
  wpo: WpoSet = NO_WPO,
) =>
  wgslProgram(
    /* wgsl */ `
${renderRasterVertex(wpo)}${renderRasterFragment(masks)}
`,
    [
      VSM_RENDER_OUT_WGSL,
      VSM_RENDER_JOIN_WGSL,
      PAGE_INFO_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      SHADOW_TILE_POOL_WGSL,
      colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
      maskKeepWgsl(maskAlphaWgsl(true, SHADOW_TILE_POOL_WGSL), masks),
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_VERTEX_SPECS, layout),
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_FRAGMENT_SPECS, layout),
      vsmBindingsWgsl(1, VSM_RENDER_RASTER_SHARED_SPECS, layout),
      PAGE_GEOMETRY_WGSL,
      maskUvWgsl(VIS_BINDINGS.normals),
      ...(wpo.programs.length ? [wpoGraphWgsl(wpo)] : []),
    ],
  )
