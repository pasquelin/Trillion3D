/**
 * Step 5, culling half: the per-page draw commands of the non-cluster raster, on the engine's
 * resident cluster rows (build of the per-page draw commands, page overlap, page cache, box cull
 * and page-mark pyramid helpers).
 *
 * Caster source: every row of the visibility page table (resident clusters), at the MAIN VIEW's
 * level of detail, and culls the instances against each VSM
 * view, never against the camera frustum. The level test is the engine's cut rule
 * (`../page/cut/rule.ts`) on the row's world errors (`webgpu/shadow/rowLods.ts`, residency folded
 * in) projected by the camera, without any frustum term: an off-screen caster is kept at the level
 * the camera's distance wants.
 *
 * Kernels (one module each, see `renderPass.ts` for the order):
 * - `vsmRenderCandidates` (per row): the caster list. Drops rows that never cast
 *   (no corners, blended-caster rows, sprites — translucent / sprite proxies do not render into
 *   VSM depth —, and rows whose placement casts no shadow: `castShadow = false`, hidden or parked,
 *   `MOBILITY_SHADOWLESS`) — and rows the camera's cut does not select, and appends the rest with
 *   their world sphere (split double), corner count, cache-as-dynamic bit (engine mobility,
 *   `webgpu/shadow/mobility.ts`) and deforming bit (`vsmRenderCandidateFlags`).
 * - `vsmRenderCull` (per candidate × map view): the per-page draw commands:
 *   distance cull, static-layer test, small-caster test, frustum (the box frustum test with
 *   the dynamic depth cull range), then per mip: screen rect, fine caster, stale rect
 *   clip, overlap with any valid page (page-mark pyramid + receiver cover), and one command (row,
 *   mip view, static, page rect, flag mask, dirty flags).
 * - `vsmRenderExpand` (one workgroup per command) = the marking loop: it marks the pages dirty
 *   over the command's page rect into the raster marks, and does the raster's page selection: one
 *   (row, page) pair per page of the rect valid for rendering, the clip planes being the uncached
 *   rect.
 * - `vsmRenderArgs*`: indirect arguments of the next stage (one thread).
 *
 * Bounds: the engine keeps a world sphere per row (`webgpu/shadow/spheres.ts`), no local box;
 * the instance box is the sphere's axis-aligned box in shifted space (local to shifted
 * world = identity, extent = radius), and the instance radius (|local bounds extent · scale|) is
 * the sphere radius.
 */
import { CUT_RULE_WGSL } from '../page/cut/rule.ts'
import { DEFAULT_GROUP_WIDTH } from '../gpu/dag/shader/gridWgsl.ts'
import { PROJECTED_BOUND_WGSL } from '../gpu/dag/shader/projectedBoundWgsl.ts'
import { MOBILITY_MOVING, MOBILITY_SHADOWLESS } from '../gpu/shadow/mobilityBits.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts'
import { FLAG_BLEND_CASTER } from '../visibility/types.ts'
import { VSM_BOX_CULL_WGSL } from './boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_MARKS_GATHER_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_COVER_GATHER_WGSL,
  VSM_STRUCTS_WGSL,
} from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL, VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import { VSM_UNIFORMS_WGSL } from './uniforms.ts'
import type { VsmLayout } from './layout.ts'

/** Threads per group of every render-cull kernel. */
export const VSM_RENDER_GROUP = 64
/** Workgroups per dispatch dimension (WebGPU default limit, the host's `dispatchGrid` width);
 *  larger counts wrap into y. */
export const VSM_RENDER_MAX_GROUPS_X = DEFAULT_GROUP_WIDTH
/** Bytes of one parameter slot (dynamic uniform offset, `minUniformBufferOffsetAlignment`). */
export const VSM_RENDER_PARAMS_SLOT = 256
/** Words per chunk in the indirect argument buffer: cull dispatch 3, expand dispatch 3, draw 4, pad 2. */
export const VSM_RENDER_ARGS_STRIDE_WORDS = 12
export const VSM_RENDER_ARGS_CULL = 0
export const VSM_RENDER_ARGS_EXPAND = 3
export const VSM_RENDER_ARGS_DRAW = 6
/** Counter words: [0] candidates, then 4 per chunk from word 4: commands, pairs, max corners, pad. */
export const VSM_RENDER_COUNTS_HEAD = 4
/** Map view flag: directional (clipmap level, 1 mip, clamp to near plane — the near-plane clamp). */
export const VSM_RENDER_VIEW_DIRECTIONAL = 1

/**
 * Per-chunk parameters (one 256-byte slot each, same frame values in every slot). The camera is the
 * main view whose level of detail the casters take: eye (split double), world-to-view rotation
 * rows (engine convention, −Z forward), focal in pixels, near, perspective 0/1, the cut's threshold.
 */
export const VSM_RENDER_PARAMS_WGSL = /* wgsl */ `
struct VsmRenderParams{
 eyeHigh:vec3f,perspective:f32,
 eyeLow:vec3f,focal:f32,
 viewRow0:vec4f,viewRow1:vec4f,viewRow2:vec4f,
 near:f32,threshold:f32,smallCasterSq:f32,rowCount:u32,
 viewCount:u32,chunk:u32,chunkFirst:u32,chunkRows:u32,
 chunkCount:u32,cmdCapacity:u32,pairCapacity:u32,pad:u32,
}
/** A caster row the camera's cut selects: world sphere (centre high + radius, centre low), its row,
 *  corners, flags (bit 0 cache as dynamic, bit 1 deforming: it invalidates the pages it draws), and the radius of
 *  its whole object (f32 bits, 0 when unknown: the row's sphere stands in). */
struct VsmRenderCandidate{c:vec4f,l:vec3f,row:u32,corners:u32,flags:u32,objectRadius:u32,pad1:u32,}
const VSM_RENDER_CAND_DYNAMIC:u32=1u;
const VSM_RENDER_CAND_DEFORMING:u32=2u;
const VSM_RENDER_VIEW_DIRECTIONAL:u32=${VSM_RENDER_VIEW_DIRECTIONAL}u;
const VSM_RENDER_COUNTS_HEAD:u32=${VSM_RENDER_COUNTS_HEAD}u;
fn vsmRenderChunkCounter(chunk:u32,k:u32)->u32{return VSM_RENDER_COUNTS_HEAD+chunk*4u+k;}
/** Linear workgroup of a dispatch wrapped into y. */
fn vsmRenderGroup(wid:vec3u,nwg:vec3u)->u32{return wid.y*nwg.x+wid.x;}
`

// ---- Candidates (per row) ----------------------------------------------------------------------

/**
 * What a candidates kernel reads of the caster rows — group 0: 0 params (uniform, dynamic), 1 page
 * table rows (`pages`), 2 row spheres, 3 row mobility words, 4 row levels of detail, 5
 * candidates (rw), 6 counters (rw atomic) — and the main view's pixels of a row's error: the
 * opaque rows' (`vsmRenderCandidatesWgsl`) and the blended rows' (`transmissionWgsl.ts`).
 */
export const VSM_RENDER_ROWS_WGSL = /* wgsl */ `
${PAGE_INFO_STRUCT_WGSL}
${VSM_RENDER_PARAMS_WGSL}
const INF:f32=3.402823466e38;
${PROJECTED_BOUND_WGSL}
${CUT_RULE_WGSL}
struct VsmRenderSphere{c:vec4f,l:vec4f,}
struct VsmRenderRowLod{own:vec4f,parent:vec4f,ownLow:vec4f,parentLow:vec4f,radii:vec4f,}
@group(0) @binding(0) var<uniform> params:VsmRenderParams;
@group(0) @binding(1) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(2) var<storage,read> spheres:array<VsmRenderSphere>;
@group(0) @binding(3) var<storage,read> mobility:array<u32>;
@group(0) @binding(4) var<storage,read> lods:array<VsmRenderRowLod>;
@group(0) @binding(5) var<storage,read_write> candidates:array<VsmRenderCandidate>;
@group(0) @binding(6) var<storage,read_write> counts:array<atomic<u32>>;
/** Error \`lod\` (world centre high + error, low residue) in the main view's pixels. */
fn vsmRenderMainPixels(lod:vec4f,low:vec4f,radius:f32)->f32{
 let delta=(lod.xyz-params.eyeHigh)+(low.xyz-params.eyeLow);
 let v=vec3f(dot(params.viewRow0.xyz,delta),dot(params.viewRow1.xyz,delta),dot(params.viewRow2.xyz,delta));
 return projectedBound(lod.w,v,radius,1.0,params.focal,params.near,params.perspective,false);
}
/** A caster row's candidate flags, from its mobility word and deformation output: cached as dynamic
 *  while its placement moves, and deforming — its pages invalidated as it draws them —
 *  only then. A deformed placement turns static once its deformation has
 *  held still for VSM_STILL_FRAMES frames, and its next change moves it again before
 *  this frame's raster, its box staling the static pages (\`noteDeformed\`,
 *  \`webgpu/pages/render/movedGeometry.ts\`): a static deformed row draws the geometry its static
 *  pages hold, and invalidating them each frame it draws them would redraw them every frame. */
fn vsmRenderCandidateFlags(word:u32,deformOutput:u32)->u32{
 if((word&${MOBILITY_MOVING}u)==0u){return 0u;}
 return VSM_RENDER_CAND_DYNAMIC|select(0u,VSM_RENDER_CAND_DEFORMING,deformOutput!=0u);
}`

/** The opaque caster rows the camera's cut selects (`VSM_RENDER_ROWS_WGSL`). */
export const vsmRenderCandidatesWgsl = () => /* wgsl */ `${VSM_RENDER_ROWS_WGSL}
@compute @workgroup_size(${VSM_RENDER_GROUP}) fn vsmRenderCandidates(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let row=vsmRenderGroup(wid,nwg)*${VSM_RENDER_GROUP}u+lane;
 if(row>=params.rowCount){return;}
 let page=pages[row];
 if(page.indexCount==0u||(page.flags&${FLAG_BLEND_CASTER}u)!=0u||page.sprite.y!=0.0||(mobility[row]&${MOBILITY_SHADOWLESS}u)!=0u){return;}
 // The main view's level of detail, residency folded.
 let lod=lods[row];
 let parentPixels=vsmRenderMainPixels(lod.parent,lod.parentLow,lod.radii.y);
 let ownPixels=vsmRenderMainPixels(lod.own,lod.ownLow,lod.radii.x);
 if(!drawsCluster(true,parentPixels,ownPixels,true,params.threshold)){return;}
 let s=spheres[row];
 let flags=vsmRenderCandidateFlags(mobility[row],page.deformOutput);
 let at=atomicAdd(&counts[0],1u);
 candidates[at]=VsmRenderCandidate(s.c,s.l.xyz,row,page.indexCount,flags,bitcast<u32>(lod.radii.z),0u);
}
`

// ---- Cull (per candidate × map view) -------------------------------------------------------

/** Group 0 of `vsmRenderCull` (VSM resources of the current frame). */
export const VSM_RENDER_CULL_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageMarks', binding: 1 },
  { resource: 'receiverCover', binding: 2 },
  { resource: 'staleRects', binding: 3 },
  { resource: 'projectionData', binding: 4 },
]

const VSM_COMMON = (layout: VsmLayout, specs: readonly VsmBindingSpec[]) => [
  VSM_CONSTANTS_WGSL,
  VSM_UNIFORMS_WGSL,
  VSM_HANDLE_WGSL,
  VSM_STRUCTS_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PROJECTION_DATA_WGSL,
  vsmBindingsWgsl(0, specs, layout),
]

/** The box frustum tests of the shared cull (`VSM_BOX_CULL_WGSL`) on a box of the shifted world,
 *  its local-to-world the identity: the shifted-to-clip matrix takes it to clip space. */
const FRUSTUM_WGSL = /* wgsl */ `
/** The frustum cull of a box under an orthographic view, identity local-to-world. */
fn vsmShiftedBoxOrtho(center:vec3f,extent:vec3f,m:mat4x4f,nearClip:bool)->VsmBoxInView{
 return vsmBoxInOrthoView((m*vec4f(center,1.0)).xyz,extent.x*m[0].xyz,extent.y*m[1].xyz,extent.z*m[2].xyz,nearClip);
}
/** The frustum cull of a box under a perspective view, identity local-to-world. */
fn vsmShiftedBoxPerspective(center:vec3f,extent:vec3f,m:mat4x4f,viewToClip:mat4x4f)->VsmBoxInView{
 return vsmBoxInPerspectiveView(m*vec4f(center-extent,1.0),(2.0*extent.x)*m[0],(2.0*extent.y)*m[1],(2.0*extent.z)*m[2],viewToClip);
}
/** The frustum cull of a box: orthographic, or perspective when near clipping is on. */
fn vsmShiftedBoxInView(center:vec3f,extent:vec3f,m:mat4x4f,viewToClip:mat4x4f,isOrtho:bool,nearClip:bool)->VsmBoxInView{
 if(isOrtho||!nearClip){return vsmShiftedBoxOrtho(center,extent,m,nearClip);}
 return vsmShiftedBoxPerspective(center,extent,m,viewToClip);
}
`

/** The page-overlap and static-caching pieces the command cull reads. */
const OVERLAP_WGSL = /* wgsl */ `
/** A mask of \`runWidth\` bits at \`runStart\`. */
fn vsmBitRun(runWidth:u32,runStart:u32)->u32{
 return ((1u<<(runWidth&31u))-1u)<<(runStart&31u);
}
/** Whether a rect of the 8x8 receiver cover intersects the 2x2 quadrant masks: x (-,+), y (+,+), z (+,-), w (-,-). */
fn vsmMaskRectHits(mask2x2:vec4u,mn:vec2u,mx:vec2u)->bool{
 let xBits=mx.x-mn.x+1u;
 let xRun=vsmBitRun(xBits,mn.x);
 let xLow=xRun&0xFu;
 let xHigh=xRun>>4u;
 let yLast4=mx.y<<2u;
 let yFirst4=mn.y<<2u;
 let yBits=yLast4-yFirst4+1u;
 let yRun=vsmBitRun(yBits,yFirst4);
 let rowsLow=0x1111u&yRun;
 let rowsHigh=0x1111u&(yRun>>16u);
 let cellBits=vec4u(xLow*rowsHigh,xHigh*rowsHigh,xHigh*rowsLow,xLow*rowsLow);
 return (mask2x2.x&cellBits.x)!=0u||(mask2x2.y&cellBits.y)!=0u||(mask2x2.z&cellBits.z)!=0u||(mask2x2.w&cellBits.w)!=0u;
}
/** Whether any valid page overlaps a pixel rect clamped to the valid page region. */
fn vsmTouchesMappedPage(h:VsmHandle,mipLevel:u32,pixels:vec4i,askedMarks:u32,fineCaster:bool,useCover:bool)->bool{
 if(any(pixels.zw<pixels.xy)){return false;}
 let pagesRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE);
 let wantedMarks=askedMarks|select(0u,VSM_PAGE_FINE,fineCaster);
 let entryCell=vsmTableEntryOf(h,mipLevel,pagesRect.xy);
 if(vsmMarksMatch(vsmRectMarks(entryCell.tableXY,pagesRect),wantedMarks)){
  if(useCover){
   let halfPageRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE-1u);
   let coverLevel=u32(vsmLevelHoldingRect(vec4i(halfPageRect),2));
   let coverCell=entryCell.tableXY*2u+(halfPageRect.xy&vec2u(1u));
   let offsetMip=halfPageRect.xy>>vec2u(coverLevel);
   let offset=offsetMip<<vec2u(VSM_LOG2_COVER_CELLS+coverLevel-1u);
   let cellRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE-VSM_LOG2_COVER_CELLS);
   let subRect=cellRect-offset.xyxy;
   let subRectAtLevel=subRect>>vec4u(coverLevel);
   let cover8x8=vsmGatherCover(coverCell,coverLevel);
   return vsmMaskRectHits(cover8x8,subRectAtLevel.xy,subRectAtLevel.zw);
  }
  return true;
 }
 return false;
}
/** Clips a pixel rect to the uncached page rect bounds of a map's mip. */
fn vsmClipToStaleRect(pixels:vec4i,h:VsmHandle,mipLevel:u32)->vec4i{
 let staleRectPages=vsmStaleRects[h.id*VSM_MIPS+mipLevel];
 let bounds=vec4i(vec4u(staleRectPages.xy<<vec2u(VSM_LOG2_PAGE),(staleRectPages.zw<<vec2u(VSM_LOG2_PAGE))+vec2u(VSM_PAGE_TEXELS-1u)));
 return vec4i(max(pixels.xy,bounds.xy),min(pixels.zw,bounds.zw));
}
/** The raster marks a drawn page takes: its static or dynamic drawn bit, and its stale bit too where the caster deforms. */
fn vsmRasterMarkBits(staticLayer:bool,staleAfter:bool)->u32{
 var flags=select(1u,2u,staticLayer);
 if(staleAfter){flags|=select(4u,8u,staticLayer);}
 return flags;
}
/** The shifted-to-clip matrix of a VSM view, from the stored shiftedToShadowUV
 *  (the clip-to-UV scale and bias inverted: x = 2u − w, y = w − 2v, z and w kept). */
fn vsmShiftedToClip(uv:mat4x4f)->mat4x4f{
 var m:mat4x4f;
 for(var k=0u;k<4u;k++){
  let c=uv[k];
  m[k]=vec4f(2.0*c.x-c.w,c.w-2.0*c.y,c.z,c.w);
 }
 return m;
}
`

/**
 * `vsmRenderCull`: group 0 = `VSM_RENDER_CULL_SPECS`; group 1: 0 params (uniform, dynamic),
 * 1 map views (vec4u: id, mip count, flags, pad), 2 candidates, 3 counters (rw atomic),
 * 4 commands (rw). Dispatch: x over the chunk's candidates (64 each), y = map view index.
 *
 * Command (vec4u): x row; y VSM id | mip << 16 | static << 19 | clamp-to-near << 20;
 * z page rect x0 | y0 << 7 | x1 << 14 | y1 << 21 (inclusive, pages of the mip);
 * w corners (16 bits) | mark mask << 16 | mark-page-dirty flags << 24.
 */
export const vsmRenderCullWgsl = (layout: VsmLayout, { marksDirty = true } = {}) =>
  [
    ...VSM_COMMON(layout, VSM_RENDER_CULL_SPECS),
    VSM_PROJECTION_DATA_READ_WGSL,
    VSM_PAGE_MARKS_GATHER_WGSL,
    VSM_COVER_GATHER_WGSL,
    VSM_RENDER_PARAMS_WGSL,
    VSM_BOX_CULL_WGSL,
    FRUSTUM_WGSL,
    OVERLAP_WGSL,
    /* wgsl */ `
@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> views:array<vec4u>;
@group(1) @binding(2) var<storage,read> candidates:array<VsmRenderCandidate>;
@group(1) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(1) @binding(4) var<storage,read_write> cmds:array<vec4u>;
@compute @workgroup_size(${VSM_RENDER_GROUP}) fn vsmRenderCull(@builtin(workgroup_id) wid:vec3u,@builtin(local_invocation_index) lane:u32){
 let local=wid.x*${VSM_RENDER_GROUP}u+lane;
 let k=params.chunkFirst+local;
 if(local>=params.chunkRows||k>=atomicLoad(&counts[0])||wid.y>=params.viewCount){return;}
 let cand=candidates[k];
 let view=views[wid.y];
 let h=vsmHandleFromId(view.x);
 let pd=vsmProjectionOf(h);
 let directional=(view.z&VSM_RENDER_VIEW_DIRECTIONAL)!=0u;
 // Local views enable distance cull and near clip.
 let nearClip=!directional;
 let distanceCull=!directional;
 let viewToClip=pd.lightViewToClip;
 let isOrtho=viewToClip[3][3]>=1.0;
 let shiftedToClip=vsmShiftedToClip(pd.shiftedToMapUv);
 let center=(cand.c.xyz+pd.originShiftHigh)+(cand.l+pd.originShiftLow);
 let radius=cand.c.w;
 var visible=true;
 // Range-based culling distance = the light's radius.
 if(distanceCull){visible=dot(center,center)<=(pd.lightRange+radius)*(pd.lightRange+radius);}
 if(!visible){return;}
 // The static layer takes a caster that stands still (the engine's mobility) in a cached map; a
 // moving one draws into the dynamic layer: its mobility decides it, frame by frame.
 let staticLayer=!pd.uncached&&(cand.flags&VSM_RENDER_CAND_DYNAMIC)==0u;
 // The receiver cover and the mark mask depend on the cache state.
 let useCover=pd.useCover&&!staticLayer;
 let markMask=select(VSM_PAGE_DYNAMIC_STALE,VSM_PAGE_STATIC_STALE,staticLayer);
 // The small-caster cull on uncached maps, an
 // instance test: the whole object's radius, not the cluster's, so a small part of a large object
 // is never dropped alone. Its centre is not kept per row: the distance is the cluster's less the
 // object's radius, nearer than the object's centre can be — it never drops what the object's own test keeps.
 if(pd.uncached){
  let objectRadius=bitcast<f32>(cand.objectRadius);
  let d=(cand.c.xyz-params.eyeHigh)+(cand.l-params.eyeLow);
  if(objectRadius>0.0){
   let near=max(length(d)-objectRadius,0.0);
   if(objectRadius*objectRadius<params.smallCasterSq*near*near){return;}
  }else if(radius*radius<params.smallCasterSq*dot(d,d)){return;}
 }
 // Frustum cull; non-static geometry also within the depth range (0, the largest float).
 let cull=vsmShiftedBoxInView(center,vec3f(radius),shiftedToClip,viewToClip,isOrtho,nearClip);
 visible=cull.inMapView;
 if(visible&&!staticLayer){
  visible=cull.clipHigh.z>0.0&&cull.clipLow.z<3.402823466e38;
 }
 if(!visible){return;}
 var pixelRadius=vsmClipRadius(isOrtho,radius,center,viewToClip)*f32(VSM_LEVEL0_TEXELS);
 let deformsNow=(cand.flags&VSM_RENDER_CAND_DEFORMING)!=0u;
 ${marksDirty ? 'let dirtyFlags=vsmRasterMarkBits(staticLayer,deformsNow);' : 'let dirtyFlags=0u;'}
 let mips=min(view.y,VSM_MIPS);
 for(var mipLevel=0u;mipLevel<mips;mipLevel++){
  let levelTexels=i32(VSM_LEVEL0_TEXELS>>mipLevel);
  var pixels=vsmRectPixels(vec4i(0,0,levelTexels,levelTexels),cull);
  let fineCaster=vsmIsFineCaster(staticLayer,pixelRadius);
  pixelRadius*=0.5;
  pixels=vsmClipToStaleRect(pixels,h,mipLevel);
  if(!vsmTouchesMappedPage(h,mipLevel,pixels,markMask,fineCaster,useCover)){continue;}
  let pagesRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE);
  let slot=atomicAdd(&counts[vsmRenderChunkCounter(params.chunk,0u)],1u);
  if(slot>=params.cmdCapacity){continue;}
  cmds[slot]=vec4u(
   cand.row,
   view.x|(mipLevel<<16u)|select(0u,1u<<19u,staticLayer)|select(0u,1u<<20u,directional),
   pagesRect.x|(pagesRect.y<<7u)|(pagesRect.z<<14u)|(pagesRect.w<<21u),
   (cand.corners&0xFFFFu)|(markMask<<16u)|(dirtyFlags<<24u));
 }
}
`,
  ].join('\n')

// ---- Expand (one workgroup per command) ---------------------------------------------------------

/** Group 0 of `vsmRenderExpand`. */
export const VSM_RENDER_EXPAND_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'pageMarks', binding: 2 },
  { resource: 'rasterMarks', binding: 3, access: 'read_write' },
]

/**
 * `vsmRenderExpand`: group 0 = `VSM_RENDER_EXPAND_SPECS`; group 1: 0 params, 1 commands, 2 counters
 * (rw atomic), 3 pairs (rw). One workgroup per command (2D wrapped), threads over its page rect.
 *
 * Pair (vec4u): x row; y VSM id | mip << 16 | clamp-to-near << 20 | pool slice << 21;
 * z virtual page x | y << 8; w physical page address x | y << 10.
 */
export const vsmRenderExpandWgsl = (layout: VsmLayout) =>
  [
    ...VSM_COMMON(layout, VSM_RENDER_EXPAND_SPECS),
    VSM_PAGE_LOOKUP_WGSL,
    VSM_PAGE_MARKS_GATHER_WGSL,
    VSM_RENDER_PARAMS_WGSL,
    /* wgsl */ `
@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> cmds:array<vec4u>;
@group(1) @binding(2) var<storage,read_write> counts:array<atomic<u32>>;
@group(1) @binding(3) var<storage,read_write> pairs:array<vec4u>;
/** Marks a physical page dirty. */
fn vsmMarkDrawnPage(page:VsmTableEntry,markBits:u32){
 if(!page.thisLevelMapped){return;}
 let drawnPool=vsmPoolIndexOf(page.physicalAddress);
 let n=vsm.poolPages;
 for(var s=0u;s<VSM_DIRTY_SLICES;s++){
  if((markBits&(1u<<s))!=0u){vsmRasterMarksStore(n*s+drawnPool,1u);}
 }
}
@compute @workgroup_size(${VSM_RENDER_GROUP}) fn vsmRenderExpand(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=vsmRenderGroup(wid,nwg);
 let count=min(atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,0u)]),params.cmdCapacity);
 if(index>=count){return;}
 let cmd=cmds[index];
 let id=cmd.y&0xFFFFu;
 let mipLevel=(cmd.y>>16u)&7u;
 let staticLayer=((cmd.y>>19u)&1u)!=0u;
 let flattenBit=(cmd.y>>20u)&1u;
 let rect=vec4u(cmd.z&0x7Fu,(cmd.z>>7u)&0x7Fu,(cmd.z>>14u)&0x7Fu,(cmd.z>>21u)&0x7Fu);
 let corners=cmd.w&0xFFFFu;
 let markMask=(cmd.w>>16u)&0xFFu;
 let markBits=(cmd.w>>24u)&((1u<<VSM_DIRTY_SLICES)-1u);
 let h=vsmHandleFromId(id);
 let levelOffset=vsmTableLevelOrigin(h,mipLevel);
 let size=(rect.zw+vec2u(1u))-rect.xy;
 // The pool slice the raster writes: the static slice for a static-cached instance.
 let slice=select(0u,vsm.staticSlice,staticLayer);
 for(var i=lane;i<size.x*size.y;i+=${VSM_RENDER_GROUP}u){
  let rowInRect=u32(floor((f32(i)+0.5)/f32(size.x)));
  let vPage=rect.xy+vec2u(i-size.x*rowInRect,rowInRect);
  let offset=vsmTableEntryAt(levelOffset,mipLevel,vPage);
  let page=vsmTableEntryAtOffset(offset);
  // The instance's own layer of this page is uncached: its static slice for a static instance, its
  // dynamic slice for a dynamic one (the cull's mark mask).
  let layerStale=(vsmPageMarkWord(offset)&markMask)!=0u;
  // Mark the page dirty: pages whose flags carry the instance's mask.
  if(layerStale){vsmMarkDrawnPage(page,markBits);}
  // The raster's page: valid for rendering, and its layer uncached. A static instance is never
  // redrawn into a cached static slice (a page stale in its dynamic layer alone, as the sun's receiver
  // mask makes every requested page each frame): its depth is already there, not merged (no
  // static drawn mark) and slice 0, which the projection reads, was initialized from it.
  if(page.thisLevelDrawable&&layerStale){
   let at=atomicAdd(&counts[vsmRenderChunkCounter(params.chunk,1u)],1u);
   if(at<params.pairCapacity){
    pairs[at]=vec4u(cmd.x,id|(mipLevel<<16u)|(flattenBit<<20u)|(slice<<21u),vPage.x|(vPage.y<<8u),page.physicalAddress.x|(page.physicalAddress.y<<10u));
    atomicMax(&counts[vsmRenderChunkCounter(params.chunk,2u)],corners);
   }
  }
 }
}
`,
  ].join('\n')

// ---- Indirect arguments -------------------------------------------------------------------------

/**
 * One-thread kernels writing the next stage's indirect arguments. Group 0: 0 params, 1 counters
 * (rw atomic), 2 arguments (rw, `VSM_RENDER_ARGS_STRIDE_WORDS` per chunk).
 */
export const VSM_RENDER_ARGS_WGSL = /* wgsl */ `
${VSM_RENDER_PARAMS_WGSL}
@group(0) @binding(0) var<uniform> params:VsmRenderParams;
@group(0) @binding(1) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
fn vsmRenderArgsAt(chunk:u32,word:u32)->u32{return chunk*${VSM_RENDER_ARGS_STRIDE_WORDS}u+word;}
fn vsmRenderWrapped(n:u32)->vec2u{return vec2u(min(n,${VSM_RENDER_MAX_GROUPS_X}u),(n+${VSM_RENDER_MAX_GROUPS_X - 1}u)/${VSM_RENDER_MAX_GROUPS_X}u);}
/** Cull dispatch of every chunk, once the candidates are known. */
@compute @workgroup_size(1) fn vsmRenderArgsCull(){
 let total=atomicLoad(&counts[0]);
 for(var c=0u;c<params.chunkCount;c++){
  let first=c*params.chunkRows;
  let n=select(0u,min(total-first,params.chunkRows),total>first);
  let at=vsmRenderArgsAt(c,${VSM_RENDER_ARGS_CULL}u);
  args[at]=(n+${VSM_RENDER_GROUP - 1}u)/${VSM_RENDER_GROUP}u;
  args[at+1u]=select(0u,params.viewCount,n>0u);
  args[at+2u]=1u;
 }
}
/** Expand dispatch of this chunk: one workgroup per command. */
@compute @workgroup_size(1) fn vsmRenderArgsExpand(){
 let n=min(atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,0u)]),params.cmdCapacity);
 let g=vsmRenderWrapped(n);
 let at=vsmRenderArgsAt(params.chunk,${VSM_RENDER_ARGS_EXPAND}u);
 args[at]=g.x;args[at+1u]=g.y;args[at+2u]=1u;
}
/** Draw of this chunk: max corners vertices, one instance per pair. */
@compute @workgroup_size(1) fn vsmRenderArgsDraw(){
 let n=min(atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,1u)]),params.pairCapacity);
 let at=vsmRenderArgsAt(params.chunk,${VSM_RENDER_ARGS_DRAW}u);
 args[at]=atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,2u)]);
 args[at+1u]=n;args[at+2u]=0u;args[at+3u]=0u;
}
`
