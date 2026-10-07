/**
 * Coloured shadows through translucent casters on top of the virtual shadow maps: the plain VSM
 * casts no shadow from a translucent material, the engine does.
 *
 * Nothing is drawn in texels. For each physical page and slice the VSM redraws, the translucent
 * triangles that cover it are binned into 16 × 16 cells of 8 × 8 texels; a receiver then tests the
 * ray toward the light exactly against the two to four triangles of its cell. The class-2 contract
 * (declared): every opaque shadow identical; inside a one-layer area the triangle's quantised
 * transmittance, as the texel store had it; edges at the exact geometric boundary; with several
 * layers only those above the receiver; a translucent receiver never shadows itself.
 *
 * Cell size, derived: a triangle of side s texels meets about 2·(1 + c/s)·(1 + c/(s·sin e)) cells
 * of side c (e the light's elevation over its plane), and a slice's cell headers take (128/c)²
 * words. The sea's triangles are 50 to 100 texels a side, a 10-pixel triangle 25 to 50: c = 8 gives
 * 2.4 to 3.5 tests a receiver for 256 header words (1 KiB); c = 4 saves a third of the tests for
 * four times the header, c = 16 doubles them.
 *
 * A slice's data, in texels (4 words) of its own virtual sequence spread over blocks of
 * `VSM_TRANSMISSION_BLOCK_TEXELS`: 64 texels of cell headers (offset in texels << 16 | count), 8
 * texels of block chain (`VSM_TRANSMISSION_CHAIN` block numbers), the records (4 texels each), the
 * cell lists (a record's texel address a word, each list padded to a texel), then the patches of
 * textured casters (a quantised transmittance a word at each texel centre). A record:
 *   texel 0: x0 y0 x1 y1 — the corners in texels of the page, from its corner;
 *   texel 1: x2 y2 then, directional, d0 d1 (each corner's world position along the map's unit
 *            axis toward the light), local, the plane normal's x y in light-relative space;
 *   texel 2: directional d2, 0; local n.z, plane offset w; then the quantised transmittance q
 *            (bit 24: textured, read from its patch) and the row;
 *   texel 3: the patch: its first word in the slice, its first texel + 1 (x | y << 16), its size.
 *
 * The readable memory is one rgba32uint texture `VSM_TRANSMISSION_WIDTH` texels wide: first the
 * page headers (each physical page's first block of its dynamic and static slice, `NONE` for
 * none, four words a texel), then the blocks, two a row. One texture keeps the consumers' binding:
 * the deferred resolve already holds the eight storage buffers WebGPU guarantees.
 *
 * Passes, all compute (`transmissionPass.ts`): clear (a redrawn slice is stamped, its counts
 * zero; a redrawn or freed slice gives its blocks back), then per chunk of blended rows the opaque
 * raster's cull (`renderCullWgsl.ts`), `pages` (each command's pages whose slice is redrawn) and
 * `bin` (each command's triangles projected once, then every (page, triangle) of it recorded or
 * skipped); then `number` (each slice with a record takes this frame's number and its place),
 * `place` (each record into its slice's run of the order) and `resolve` (a group per slice builds
 * its cells in the group's memory, takes its blocks from the pool and writes its cell lists and
 * records), and `headers` (the page headers of the slices that changed). No global atomic is
 * issued per cell: the cells are counted in a slice's own group.
 */
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FLOAT32_MAX } from '../../../math/src/wgsl/constants.ts'
import { matrixWindingCw } from '../../../math/src/wgsl/matrix.ts'
import { bilinear3 } from '../../../math/src/wgsl/sampling.ts'
import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { MASK_KEEP_WGSL, PAGE_BINDING, PAGE_INFO_WGSL } from '../visibility/shader/pageWgsl.ts'
import { FLAG_BLEND_CASTER, FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_MASK } from '../visibility/types.ts'
import { VIS_BINDINGS } from '../webgpu/core/bindLayout.ts'
import {
  COLOR_SAMPLE_WGSL,
  maskAlphaWgsl,
  tileDeclarations,
  tilePoolWgsl,
} from '../webgpu/tile/wgsl.ts'
import { BLEND_TRANSMITTANCE_WGSL } from '../gpu/shadow/transmittanceWgsl.ts'
import { MOBILITY_SHADOWLESS } from '../gpu/shadow/mobilityBits.ts'
import { VSM_CONSTANTS_WGSL, VSM_F32_BELOW_ONE, VSM_PAGE_TEXELS } from './constants.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_MARKS_GATHER_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_STRUCTS_WGSL,
} from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { VSM_RENDER_GROUP, VSM_RENDER_PARAMS_WGSL, VSM_RENDER_ROWS_WGSL } from './renderCullWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import {
  headerRows,
  VSM_TRANSMISSION_BLOCK_TEXELS,
  VSM_TRANSMISSION_COUNTERS,
  VSM_TRANSMISSION_FORMAT,
  VSM_TRANSMISSION_RECORD_WORDS,
  vsmTransmissionRegions,
  VSM_TRANSMISSION_WIDTH,
} from './transmissionLayout.ts'
import { floorLog2 } from '../../../math/src/scalar/integers.ts'
import { FLAT_INDEX_WGSL, GROUP_GRID_WGSL } from '../gpu/dispatch/grid.ts'
import { VSM_UNIFORMS_WGSL } from './uniforms.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/** Texels a side of a cell. */
const VSM_TRANSMISSION_CELL = 8
/** Cells a side of a page. */
const VSM_TRANSMISSION_CELLS = VSM_PAGE_TEXELS / VSM_TRANSMISSION_CELL
const CELL_COUNT = VSM_TRANSMISSION_CELLS ** 2
/** Blocks a slice chains at most: 65 536 words, a sun at 5° over two layers of 10-pixel triangles. */
const VSM_TRANSMISSION_CHAIN = 32
/** The shifts that divide by a block, by the width, by the pages a header row holds (four words a
 *  texel, two a page): every size a power of two, so the read folds by mask and shift. */
const BLOCK_SHIFT = floorLog2(VSM_TRANSMISSION_BLOCK_TEXELS)
const WIDTH_SHIFT = floorLog2(VSM_TRANSMISSION_WIDTH)
const HEADER_SHIFT = WIDTH_SHIFT + 1
/** A slice's first texels: the cell headers, then the chain. */
const HEADER_TEXELS = CELL_COUNT / 4
const RECORDS_TEXEL = HEADER_TEXELS + VSM_TRANSMISSION_CHAIN / 4
/** No block, no slice number, no list entry. */
export const VSM_TRANSMISSION_NONE = 0xffffffff
/** The resolve's binding of the memory: the old shadow requests' number, free since the VSM. */
export const VSM_TRANSMISSION_RESOLVE_BINDING = 14
/** Bytes of a command's header in the chunk's page list (row, map | mip | flags, first page, page
 *  count) and of one of its pages (slice key, virtual page). */
export const VSM_TRANSMISSION_HEADER_BYTES = 16
export const VSM_TRANSMISSION_PAGE_BYTES = 8
/** A record's transmittance word: read from its patch (a textured caster), not its own value. */
const TEXTURED_BIT = 1 << 24
/** A record's cells word (\`vsmTCellsWord\`): the triangle turns clockwise. */
const CLOCKWISE_BIT = 1 << 16

const COUNTERS_WGSL = wgslBlock(
  'VSM_TRANSMISSION_COUNTERS_WGSL',
  [],
  Object.entries(VSM_TRANSMISSION_COUNTERS)
    .map(([name, at]) => `const VSM_TC_${name.toUpperCase()}:u32=${at}u;`)
    .join('\n'),
)

/** The frame uniform: the clear's stamp, the first blended row, the capacities, where the records
 *  and patches start, and the chunk lists' commands and pages (`VsmTransmissionFrame`). */
const FRAME_STRUCT_WGSL = wgslBlock(
  'FRAME_STRUCT_WGSL',
  [],
  `
struct VsmTransmissionFrame{stamp:u32,rowFirst:u32,records:u32,patchWords:u32,blocks:u32,regionRecords:u32,regionPatches:u32,cmds:u32,pairs:u32,spare0:u32,spare1:u32,spare2:u32,}`,
)

/** The frame uniform, the build buffer's regions and the common constants. */
const frameWgsl = (layout: VsmLayout) => {
  const P = layout.poolPages
  const r = vsmTransmissionRegions(P, { records: 0, patchWords: 0, blocks: 0 })
  return wgslBlock(
    `vsmTransmissionFrame(${P})`,
    [FRAME_STRUCT_WGSL, COUNTERS_WGSL, FLAT_INDEX_WGSL],
    `const VSM_T_STAMPS:u32=${r.stamps}u;
const VSM_T_FIRST:u32=${r.first}u;
const VSM_T_COUNTS:u32=${r.counts}u;
const VSM_T_PATCH:u32=${r.patchCounts}u;
const VSM_T_KEYS:u32=${r.sliceKeys}u;
const VSM_T_DIRTY:u32=${r.dirty}u;
const VSM_T_ORDER:u32=${r.order}u;
const VSM_T_KEY_COUNT:u32=${2 * P}u;
const VSM_T_NONE:u32=${VSM_TRANSMISSION_NONE}u;
const VSM_T_CELLS:u32=${CELL_COUNT}u;
const VSM_T_CHAIN:u32=${VSM_TRANSMISSION_CHAIN}u;
const VSM_T_BLOCK_TEXELS:u32=${VSM_TRANSMISSION_BLOCK_TEXELS}u;
const VSM_T_RECORDS_TEXEL:u32=${RECORDS_TEXEL}u;
const VSM_T_RECORD_WORDS:u32=${VSM_TRANSMISSION_RECORD_WORDS}u;
const VSM_T_HEADER_ROWS:u32=${headerRows(P)}u;
/** Where block \`b\`'s texel \`t\` lies in the readable memory. */
fn vsmTBlockTexel(b:u32,t:u32)->vec2u{return vec2u((b&1u)*VSM_T_BLOCK_TEXELS+t,VSM_T_HEADER_ROWS+(b>>1u));}`,
  )
}

/** One dispatch's arguments for `n` groups, in rows. */
const ARGS_WGSL = wgslBlock(
  'ARGS_WGSL',
  [GROUP_GRID_WGSL],
  `
fn vsmTArgs(at:u32,n:u32){let g=groupGrid(n);args[at]=g.x;args[at+1u]=g.y;args[at+2u]=1u;}`,
)

// ---- Candidates ---------------------------------------------------------------------------------

/**
 * The blended caster rows, as `vsmRenderCandidates` takes the opaque ones (same LOD test, same
 * candidate record): group 0 = that kernel's (0 params, 1 rows, 2 spheres, 3 mobility, 4 levels,
 * 5 candidates, 6 counters) and 7 the frame uniform (`rowFirst`). `params.rowCount` is the number
 * of blended rows.
 */
export const vsmTransmissionCandidatesWgsl = () =>
  wgslProgram(
    `@group(0) @binding(7) var<uniform> frame:VsmTransmissionFrame;
@compute @workgroup_size(${VSM_RENDER_GROUP}) fn vsmTransmissionCandidates(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=flatIndex(wid,nwg,1u)*${VSM_RENDER_GROUP}u+lane;
 if(i>=params.rowCount){return;}
 let row=frame.rowFirst+i;
 let page=pages[row];
 if(page.indexCount==0u||(page.flags&${FLAG_BLEND_CASTER}u)==0u||page.sprite.y!=0.0||(mobility[row]&${MOBILITY_SHADOWLESS}u)!=0u){return;}
 let lod=lods[row];
 let parentPixels=vsmRenderMainPixels(lod.parent,lod.parentLow,lod.radii.y);
 let ownPixels=vsmRenderMainPixels(lod.own,lod.ownLow,lod.radii.x);
 if(!drawsCluster(true,parentPixels,ownPixels,true,params.threshold)){return;}
 let s=spheres[row];
 let at=atomicAdd(&counts[0],1u);
 candidates[at]=VsmRenderCandidate(s.c,s.l.xyz,row,page.indexCount,vsmRenderCandidateFlags(mobility[row],page.deformOutput),0u,0u);
}
`,
    [VSM_RENDER_ROWS_WGSL, FRAME_STRUCT_WGSL, FLAT_INDEX_WGSL],
  )

// ---- Clear --------------------------------------------------------------------------------------

/** Group 0 of the clear: the VSM uniforms and the pool page info. */
export const VSM_TRANSMISSION_CLEAR_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'poolPageInfo', binding: 1 },
]

/** Threads of a group of the page-wide kernels. */
export const VSM_TRANSMISSION_PAGE_GROUP = 256

/** The persistent tables: page × slice → first block, the block pool [free count, spare, free
 *  blocks…], each block's next in its chain. */
const transmissionTables = (group: number, first: number) => /* wgsl */ `
@group(${group}) @binding(${first}) var<storage,read_write> table:array<u32>;
@group(${group}) @binding(${first + 1}) var<storage,read_write> pool:array<atomic<u32>>;
@group(${group}) @binding(${first + 2}) var<storage,read_write> links:array<u32>;`

/**
 * The clear, one thread per physical page and slice, each slice's rule the page clear's: a slice
 * the VSM redraws this frame (its UNCACHED flag, the page referenced) is stamped, its record and
 * patch counts zero; it, or a slice of a page no longer allocated, gives its blocks back to the
 * pool, its table entry none, and is listed dirty (`vsmTransmissionNumber`, `headers`). No word of
 * a block is cleared: a block given back is read again only once written. Group 0: the VSM uniforms
 * and page metadata (`VSM_TRANSMISSION_CLEAR_SPECS`); group 1: 0 frame uniform, 1 build buffer,
 * 2 table, 3 pool, 4 links.
 */
export const vsmTransmissionClearWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(1) @binding(0) var<uniform> frame:VsmTransmissionFrame;
@group(1) @binding(1) var<storage,read_write> build:array<atomic<u32>>;
${transmissionTables(1, 2)}
fn vsmTransmissionRelease(index:u32,slice:u32){
 let flags=vsmPoolPageInfo[index].flags;
 let allocated=(flags&VSM_PAGE_WANTED)!=0u;
 let kept=(flags&VSM_META_UNSEEN)!=0u;
 // The slice's own flag (the static one when the cache keeps a static slice).
 let uncached=select(VSM_PAGE_DYNAMIC_STALE,VSM_PAGE_STATIC_STALE,slice==1u&&vsm.staticSlice==1u);
 let redrawn=allocated&&(flags&uncached)!=0u&&!kept;
 let key=2u*index+slice;
 if(redrawn){
  atomicStore(&build[VSM_T_STAMPS+key],frame.stamp);
  atomicStore(&build[VSM_T_COUNTS+key],0u);
  atomicStore(&build[VSM_T_PATCH+key],0u);
 }
 var b=table[key];
 if((redrawn||!allocated)&&b!=VSM_T_NONE){
  table[key]=VSM_T_NONE;
  for(var n=0u;n<VSM_T_CHAIN&&b<frame.blocks;n++){
   let at=atomicAdd(&pool[0],1u);
   atomicStore(&pool[2u+at],b);
   b=links[b];
  }
  if(!redrawn){atomicStore(&build[VSM_T_DIRTY+atomicAdd(&build[VSM_TC_DIRTY],1u)],key);}
 }
 if(redrawn){atomicStore(&build[VSM_T_DIRTY+atomicAdd(&build[VSM_TC_DIRTY],1u)],key);}
}
@compute @workgroup_size(${VSM_TRANSMISSION_PAGE_GROUP}) fn vsmTransmissionClear(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=vsm.poolPages){return;}
 vsmTransmissionRelease(id.x,0u);
 vsmTransmissionRelease(id.x,1u);
}
`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_UNIFORMS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_STRUCTS_WGSL,
      vsmBindingsWgsl(0, VSM_TRANSMISSION_CLEAR_SPECS, layout),
      frameWgsl(layout),
    ],
  )

// ---- Pages: each command's slices ---------------------------------------------------------------

/** Group 0 of `vsmTransmissionPages`: the VSM uniforms, page table and page marks. */
export const VSM_TRANSMISSION_PAGES_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'pageMarks', binding: 2 },
]

/** Threads of the per-command kernels: a sea row's triangles (≤ 22) in one round, a row's most
 *  (128) in two, and the 81 to 121 pages of a sea command's rect in two. */
const VSM_TRANSMISSION_COMMAND_GROUP = 64

/**
 * `vsmTransmissionPages`, one group per command of the chunk's cull (the shared expand's dispatch,
 * `vsmRenderArgsExpand`): the pages of its rect the expand would pair (valid for rendering, the
 * command's layer uncached) whose slice the clear stamped, counted in the group, reserved at once
 * in the chunk's page list (its pair counter), then listed as (slice key, virtual page) after the
 * headers; the command's header (row, map | mip | flags, first page, page count) at its own slot,
 * an empty one for a slot past the chunk's commands. Group 0: `VSM_TRANSMISSION_PAGES_SPECS`;
 * group 1: 0 params (dynamic), 1 commands, 2 render counters, 3 the page list, 4 build buffer,
 * 5 frame uniform.
 */
export const vsmTransmissionPagesWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> cmds:array<vec4u>;
@group(1) @binding(2) var<storage,read_write> counts:array<atomic<u32>>;
@group(1) @binding(3) var<storage,read_write> list:array<u32>;
@group(1) @binding(4) var<storage,read> build:array<u32>;
@group(1) @binding(5) var<uniform> frame:VsmTransmissionFrame;
var<workgroup> wgCommands:u32;
var<workgroup> wgFound:atomic<u32>;
var<workgroup> wgBase:u32;
fn vsmTHeader(index:u32,h:vec4u){list[4u*index]=h.x;list[4u*index+1u]=h.y;list[4u*index+2u]=h.z;list[4u*index+3u]=h.w;}
/** Page \`i\` of the rect's slice key when the command's triangles go there this frame, else none. */
fn vsmTPageKey(levelOffset:VsmTableLevel,mip:u32,vPage:vec2u,markMask:u32,slice:u32)->u32{
 let offset=vsmTableEntryAt(levelOffset,mip,vPage);
 let page=vsmTableEntryAtOffset(offset);
 if(!page.thisLevelDrawable||(vsmPageMarkWord(offset)&markMask)==0u){return VSM_T_NONE;}
 let key=2u*(page.physicalAddress.y*${layout.poolPagesXY[0]}u+page.physicalAddress.x)+(slice&1u);
 if(build[VSM_T_STAMPS+key]!=frame.stamp){return VSM_T_NONE;}
 return key;
}
fn vsmTRectPage(rect:vec4u,size:vec2u,i:u32)->vec2u{
 let y=u32(floor((f32(i)+0.5)/f32(size.x)));
 return rect.xy+vec2u(i-size.x*y,y);
}
@compute @workgroup_size(${VSM_TRANSMISSION_COMMAND_GROUP}) fn vsmTransmissionPages(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u);
 if(index>=frame.cmds){return;}
 if(lane==0u){
  wgCommands=min(atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,0u)]),params.cmdCapacity);
  atomicStore(&wgFound,0u);
 }
 if(index>=workgroupUniformLoad(&wgCommands)){
  if(lane==0u){vsmTHeader(index,vec4u(0u));}
  return;
 }
 let cmd=cmds[index];
 let id=cmd.y&0xFFFFu;
 let mip=(cmd.y>>16u)&7u;
 let rect=vec4u(cmd.z&0x7Fu,(cmd.z>>7u)&0x7Fu,(cmd.z>>14u)&0x7Fu,(cmd.z>>21u)&0x7Fu);
 let markMask=(cmd.w>>16u)&0xFFu;
 let levelOffset=vsmTableLevelOrigin(vsmHandleFromId(id),mip);
 let size=(rect.zw+vec2u(1u))-rect.xy;
 // The pool slice the raster writes: the static slice for a static-cached instance.
 let slice=select(0u,vsm.staticSlice,((cmd.y>>19u)&1u)!=0u);
 for(var i=lane;i<size.x*size.y;i+=${VSM_TRANSMISSION_COMMAND_GROUP}u){
  if(vsmTPageKey(levelOffset,mip,vsmTRectPage(rect,size,i),markMask,slice)!=VSM_T_NONE){atomicAdd(&wgFound,1u);}
 }
 workgroupBarrier();
 if(lane==0u){
  let found=atomicLoad(&wgFound);
  let base=atomicAdd(&counts[vsmRenderChunkCounter(params.chunk,1u)],found);
  wgBase=base;
  atomicStore(&wgFound,0u);
  vsmTHeader(index,vec4u(cmd.x,cmd.y,base,select(0u,min(found,frame.pairs-base),base<frame.pairs)));
 }
 let base=workgroupUniformLoad(&wgBase);
 for(var i=lane;i<size.x*size.y;i+=${VSM_TRANSMISSION_COMMAND_GROUP}u){
  let vPage=vsmTRectPage(rect,size,i);
  let key=vsmTPageKey(levelOffset,mip,vPage,markMask,slice);
  if(key==VSM_T_NONE){continue;}
  let at=base+atomicAdd(&wgFound,1u);
  if(at>=frame.pairs){continue;}
  list[4u*frame.cmds+2u*at]=key;
  list[4u*frame.cmds+2u*at+1u]=vPage.x|(vPage.y<<8u);
 }
}
`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_UNIFORMS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_STRUCTS_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      vsmBindingsWgsl(0, VSM_TRANSMISSION_PAGES_SPECS, layout),
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PAGE_MARKS_GATHER_WGSL,
      VSM_RENDER_PARAMS_WGSL,
      frameWgsl(layout),
    ],
  )

// ---- Shared geometry: the exact edge rule -------------------------------------------------------

/**
 * The edge rule the read applies, one text for every caller. Edge (a, b) is evaluated in a
 * canonical direction — its endpoints ordered by x, then y — so two triangles sharing it compute
 * the same value to the bit and lie on opposite sides: a point is inside one alone. A point on the
 * edge (value exactly 0) belongs to the triangle on the left of the canonical direction, the same
 * as a point moved by an infinitesimal (−ε², ε): a shared vertex too belongs to exactly one
 * triangle of a closed fan. A triangle of zero area seen from the light holds nothing. The side of
 * each edge is that of its third corner, evaluated by the same function.
 */
const VSM_TRANSMISSION_EDGE_WGSL = wgslBlock(
  'VSM_TRANSMISSION_EDGE_WGSL',
  [],
  `
fn vsmTEdge(a:vec2f,b:vec2f,p:vec2f)->f32{
 let swap=b.x<a.x||(b.x==a.x&&b.y<a.y);
 let lo=select(a,b,swap);let hi=select(b,a,swap);
 return (hi.x-lo.x)*(p.y-lo.y)-(hi.y-lo.y)*(p.x-lo.x);
}
fn vsmTEdgeHolds(a:vec2f,b:vec2f,third:vec2f,p:vec2f)->bool{
 let side=vsmTEdge(a,b,third);
 let e=vsmTEdge(a,b,p);
 return side!=0.0&&select((e<0.0),(e>=0.0),side>0.0);
}
fn vsmTInside(a:vec2f,b:vec2f,c:vec2f,p:vec2f)->bool{
 return vsmTEdgeHolds(a,b,c,p)&&vsmTEdgeHolds(b,c,a,p)&&vsmTEdgeHolds(c,a,b,p);
}
/** The barycentric weights of \`p\` (inside), each edge's value at \`p\` over its value at the
 *  opposite corner. */
fn vsmTWeights(a:vec2f,b:vec2f,c:vec2f,p:vec2f)->vec3f{
 return vec3f(vsmTEdge(b,c,p)/vsmTEdge(b,c,a),vsmTEdge(c,a,p)/vsmTEdge(c,a,b),vsmTEdge(a,b,p)/vsmTEdge(a,b,c));
}`,
)

/**
 * Whether triangle (a, b, c) of orientation \`s\` (±1) may cover a point of the cell [lo, hi]: no
 * edge leaves the whole cell outside (the cell's own axes are its bounding box's test). The cell
 * comes in grown by 2⁻¹⁰ texel and each edge's value is allowed 2⁻²⁰ of its terms' magnitude, so no
 * point the read finds inside (\`vsmTInside\`) misses its cell to rounding.
 */
const VSM_TRANSMISSION_COVER_WGSL = wgslBlock(
  'VSM_TRANSMISSION_COVER_WGSL',
  [],
  `
fn vsmTEdgeMeets(a:vec2f,b:vec2f,s:f32,lo:vec2f,hi:vec2f)->bool{
 let d=b-a;
 let px=select(lo.x,hi.x,-s*d.y>0.0);
 let py=select(lo.y,hi.y,s*d.x>0.0);
 let u=d.x*(py-a.y);let v=d.y*(px-a.x);
 return s*(u-v)>=-(abs(u)+abs(v))*${2 ** -20};
}
fn vsmTCovers(a:vec2f,b:vec2f,c:vec2f,s:f32,lo:vec2f,hi:vec2f)->bool{
 return vsmTEdgeMeets(a,b,s,lo,hi)&&vsmTEdgeMeets(b,c,s,lo,hi)&&vsmTEdgeMeets(c,a,s,lo,hi);
}
/** The cells a box [lo, hi] grown by 2⁻¹⁰ texel meets, first and last, on the page. */
fn vsmTCellRange(lo:vec2f,hi:vec2f)->vec4f{
 let grow=${2 ** -10};
 let c0=clamp(floor((lo-grow)/${VSM_TRANSMISSION_CELL}.0),vec2f(0.0),vec2f(${VSM_TRANSMISSION_CELLS - 1}.0));
 let c1=clamp(floor((hi+grow)/${VSM_TRANSMISSION_CELL}.0),vec2f(0.0),vec2f(${VSM_TRANSMISSION_CELLS - 1}.0));
 return vec4f(c0,c1);
}
/** Whether triangle (a, b, c) of orientation \`s\` may cover cell \`cell\`: the cell grown by 2⁻¹⁰. */
fn vsmTCoversCell(a:vec2f,b:vec2f,c:vec2f,s:f32,cell:vec2f)->bool{
 let grow=${2 ** -10};
 let lo=cell*${VSM_TRANSMISSION_CELL}.0-grow;
 return vsmTCovers(a,b,c,s,lo,lo+${VSM_TRANSMISSION_CELL}.0+2.0*grow);
}`,
)

// ---- Bin ----------------------------------------------------------------------------------------

/**
 * One group per command (`vsmTransmissionPages` listed its slices). Its row's triangles, a thread
 * each, 64 at a time: their corners decoded, deformed and placed in the world by the camera's own
 * functions (`pageTriangle`, `pagePosition`: the shadow is cast by the surface drawn), projected
 * as the opaque raster does (same matrix, same origin shift, a directional caster nearer than the
 * near plane flattened onto it, a local light's triangle clipped by its near plane into 0 to 2
 * triangles); facing the light and `volumeBoundary` as the old pass; the transmittance
 * `blendTransmittance` along the flat ray (the light's axis, or from the light to the first
 * corner); a triangle that lets all through keeps no corner. Each is projected once for every
 * page of the command, into the group's memory. Then every (page, triangle) of the command, a
 * thread each: a triangle whose box on the level misses the page by more than a texel is skipped
 * (the box is the same corners' before the page's corner is taken off, so the margin only ever
 * keeps more), the others go to `vsmTRecord` with the corners in the page's texels — the record,
 * its patch for a textured caster (a quantised transmittance at each texel centre of its box on
 * the page grown by a texel, the uv gradients one texel apart, \`maskKeep\` cutting to white), and
 * the cells it may cover, which the resolve lists. Counters keep counting past a capacity: the
 * feedback reads what the frame wanted.
 *
 * Group 0 = the engine's shadow page group. Group 1: 0 the chunk's page list, 1 projection data,
 * 2 frame uniform, 3 build buffer.
 */
export const vsmTransmissionBinWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
@group(0) @binding(${VIS_BINDINGS.uv}) var<storage, read> uvs:array<f32>;
${tileDeclarations(VIS_BINDINGS.color, 'color')}
@group(0) @binding(${VIS_BINDINGS.sampler}) var mapsSampler:sampler;
@group(1) @binding(0) var<storage,read> list:array<u32>;
@group(1) @binding(1) var<storage,read> vsmProjectionData:array<VsmProjectionRecord>;
@group(1) @binding(2) var<uniform> frame:VsmTransmissionFrame;
@group(1) @binding(3) var<storage,read_write> build:array<atomic<u32>>;
/** Whether the row's transmittance varies over a triangle: a map or a mask read at its uv. */
fn vsmTVaries(page:PageInfo)->bool{
 return (page.flags&${FLAG_HAS_UV}u)!=0u&&(page.flags&${FLAG_HAS_MAP | FLAG_MASK}u)!=0u;
}
/** The quantised transmittance the old texel store held: 1 − through, 8 bits a channel, 0 for a
 *  point the mask cuts or one that lets all through. */
fn vsmTQuantised(page:PageInfo,uv:vec2f,gx:vec2f,gy:vec2f,ray:vec3f)->u32{
 if(!maskKeep(page,uv,1.0,gx,gy)){return 0u;}
 let through=clamp(blendTransmittance(page,uv,gx,gy,ray).rgb,vec3f(0.0),vec3f(1.0));
 if(all(through>=vec3f(1.0))){return 0u;}
 return pack4x8unorm(vec4f(1.0-through,0.0));
}
/** A projected corner: its homogeneous map position and its uv. */
struct VsmTCorner{h:vec4f,uv:vec2f,}
/** The corner where segment (inside, outside) meets the near plane w − z = 0, from the inside
 *  corner: a segment two triangles share is cut to the same bits by both. */
fn vsmTCut(i:VsmTCorner,o:VsmTCorner)->VsmTCorner{
 let di=i.h.w-i.h.z;let t=di/(di-(o.h.w-o.h.z));
 return VsmTCorner(i.h+(o.h-i.h)*t,i.uv+(o.uv-i.uv)*t);
}
/** Texels of the page of a homogeneous map position: the raster's mapping. */
fn vsmTTexel(h:vec4f,scale:f32,corner:vec2f)->vec2f{return vec2f(h.x/h.w*scale,h.y/h.w*scale)-corner;}
/** The uv at texel point \`p\` of the projected triangle, perspective-correct. */
fn vsmTUvAt(x:array<vec2f,3>,c:array<VsmTCorner,3>,p:vec2f)->vec2f{
 let b=vec3f(vsmTArea(x[1],x[2],p),vsmTArea(x[2],x[0],p),vsmTArea(x[0],x[1],p))/vec3f(c[0].h.w,c[1].h.w,c[2].h.w);
 return (b.x*c[0].uv+b.y*c[1].uv+b.z*c[2].uv)/(b.x+b.y+b.z);
}
fn vsmTArea(a:vec2f,b:vec2f,p:vec2f)->f32{return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}
/** A record's cells, for the resolve: the cell range a box [lo, hi] grown by 2⁻¹⁰ texel meets
 *  (\`vsmTCellRange\`), four bits a corner, and bit 16 when the triangle turns clockwise. */
fn vsmTCellsWord(lo:vec2f,hi:vec2f,area:f32)->u32{
 let r=vec4u(vsmTCellRange(lo,hi));
 return r.x|(r.y<<4u)|(r.z<<8u)|(r.w<<12u)|select(0u,${CLOCKWISE_BIT}u,area<0.0);
}
/**
 * One projected triangle into slice \`key\`: \`x\` its corners in page texels, \`c\` their map
 * positions and uv, \`shape\` record words 6 to 9 after the corners' (directional d0 d1 d2 0, local
 * n w), \`q\` its quantised transmittance (textured: from its patch).
 */
fn vsmTRecord(page:PageInfo,row:u32,key:u32,x:array<vec2f,3>,c:array<VsmTCorner,3>,shape:vec4f,q:u32,ray:vec3f){
 let area=vsmTArea(x[0],x[1],x[2]);
 if(area==0.0){return;}
 let lo=min(min(x[0],x[1]),x[2]);let hi=max(max(x[0],x[1]),x[2]);
 if(hi.x<0.0||hi.y<0.0||lo.x>=${VSM_PAGE_TEXELS}.0||lo.y>=${VSM_PAGE_TEXELS}.0){return;}
 let textured=vsmTVaries(page);
 // The patch first: the box on the page, a texel wider each side, every centre a bilinear read
 // takes. A record slot is taken only once its patch holds, so every slot the resolve reads is
 // written this frame.
 var patchAt=0u;var patchLocal=0u;var origin=vec2i(0);var size=vec2u(0u);
 if(textured){
  origin=max(vec2i(floor(lo))-vec2i(1),vec2i(-1));
  let end=min(vec2i(ceil(hi))+vec2i(1),vec2i(${VSM_PAGE_TEXELS + 1}));
  size=vec2u(end-origin);
  let words=size.x*size.y;
  patchAt=atomicAdd(&build[VSM_TC_PATCHWORDS],words);
  if(patchAt+words>frame.patchWords){return;}
 }
 let g=atomicAdd(&build[VSM_TC_RECORDS],1u);
 if(g>=frame.records){return;}
 let local=atomicAdd(&build[VSM_T_COUNTS+key],1u);
 if(textured){
  let words=size.x*size.y;
  patchLocal=atomicAdd(&build[VSM_T_PATCH+key],(words+3u)&~3u);
  let base=frame.regionPatches+patchAt;
  for(var j=0u;j<size.y;j++){
   for(var i=0u;i<size.x;i++){
    let p=vec2f(origin+vec2i(vec2u(i,j)))+0.5;
    let uv=vsmTUvAt(x,c,p);
    let gx=vsmTUvAt(x,c,p+vec2f(1.0,0.0))-uv;let gy=vsmTUvAt(x,c,p+vec2f(0.0,1.0))-uv;
    atomicStore(&build[base+j*size.x+i],vsmTQuantised(page,uv,gx,gy,ray));
   }
  }
 }
 let r=frame.regionRecords+g*VSM_T_RECORD_WORDS;
 atomicStore(&build[r],bitcast<u32>(x[0].x));atomicStore(&build[r+1u],bitcast<u32>(x[0].y));
 atomicStore(&build[r+2u],bitcast<u32>(x[1].x));atomicStore(&build[r+3u],bitcast<u32>(x[1].y));
 atomicStore(&build[r+4u],bitcast<u32>(x[2].x));atomicStore(&build[r+5u],bitcast<u32>(x[2].y));
 atomicStore(&build[r+6u],bitcast<u32>(shape.x));atomicStore(&build[r+7u],bitcast<u32>(shape.y));
 atomicStore(&build[r+8u],bitcast<u32>(shape.z));atomicStore(&build[r+9u],bitcast<u32>(shape.w));
 atomicStore(&build[r+10u],select(q,${TEXTURED_BIT}u,textured));
 atomicStore(&build[r+11u],row);
 atomicStore(&build[r+12u],patchLocal);
 atomicStore(&build[r+13u],u32(origin.x+1)|(u32(origin.y+1)<<16u));
 atomicStore(&build[r+14u],size.x|(size.y<<16u));
 atomicStore(&build[r+15u],0u);
 atomicStore(&build[r+16u],key);
 atomicStore(&build[r+17u],local);
 atomicStore(&build[r+18u],patchAt);
 atomicStore(&build[r+19u],vsmTCellsWord(lo,hi,area));
}
/** A triangle of the row projected on the command's level: its 0, 3 or 4 corners (a local
 *  light's near plane fans 4 into two), their box in the level's texels, its record shape, its
 *  quantised transmittance and its ray. */
struct VsmTTri{h:array<vec4f,4>,uv:array<vec2f,4>,shape:vec4f,box:vec4f,ray:vec3f,count:u32,q:u32,}
fn vsmTProject(page:PageInfo,h:ClusterHeader,t:u32,view:u32,raw:VsmProjectionRecord)->VsmTTri{
 var out:VsmTTri;
 let tri=pageTriangle(page,h,t);
 let w=page.world;
 let M=raw.shiftedToMapUv;
 let isOrtho=raw.lightViewToClip[3][3]>=1.0;
 let flatten=((view>>20u)&1u)!=0u;
 let mapped=(page.flags&${FLAG_HAS_UV}u)!=0u;
 var world:array<vec3f,3>;var shifted:array<vec3f,3>;var corners:array<VsmTCorner,3>;
 for(var i=0u;i<3u;i++){
  let p=(w*vec4f(pagePosition(page,h,tri[i]),1.0)).xyz;
  world[i]=p;
  shifted[i]=(p+raw.originShiftHigh)+raw.originShiftLow;
  var m=M*vec4f(shifted[i],1.0);
  // A sun level's corner in front of its near plane is flattened onto it, as the opaque raster
  // flattens it (1 − 2^-24, \`renderRasterWgsl.ts\`); an orthographic corner's depth is read no further.
  if(flatten&&m.z>m.w){m=vec4f(m.xy,${VSM_F32_BELOW_ONE},1.0);}
  corners[i]=VsmTCorner(m,select(vec2f(0.0),pageUv(page,h,tri[i]),mapped));
 }
 // Both faces; the volume rule needs the side facing the light.
 var n=cross(world[1]-world[0],world[2]-world[0]);
 if(matrixWindingCw(w)){n=-n;}
 let axis=vec3f(M[0].z,M[1].z,M[2].z);
 let front=dot(n,select(-shifted[0],axis,isOrtho))>0.0;
 if(!volumeBoundary(page,front)){return out;}
 out.ray=select(shifted[0],axis,isOrtho);
 if(!vsmTVaries(page)){
  out.q=vsmTQuantised(page,vec2f(0.0),vec2f(0.0),vec2f(0.0),out.ray);
  if(out.q==0u){return out;}
 }
 // The record's shape: each corner along the unit axis toward the light, or the plane in
 // light-relative space (the light at the shifted origin).
 if(isOrtho){
  let a=normalize(axis);
  out.shape=vec4f(dot(world[0],a),dot(world[1],a),dot(world[2],a),0.0);
 }else{
  let nl=normalize(cross(shifted[1]-shifted[0],shifted[2]-shifted[0]));
  out.shape=vec4f(nl,dot(nl,shifted[0]));
 }
 // A local light's near plane: the polygon kept on w − z ≥ 0, 0 to 4 corners, fanned.
 if(isOrtho){
  for(var i=0u;i<3u;i++){out.h[i]=corners[i].h;out.uv[i]=corners[i].uv;}
  out.count=3u;
 }else{
  for(var i=0u;i<3u;i++){
   let a=corners[i];let b=corners[(i+1u)%3u];
   let ina=a.h.w-a.h.z>=0.0;let inb=b.h.w-b.h.z>=0.0;
   if(ina){out.h[out.count]=a.h;out.uv[out.count]=a.uv;out.count++;}
   if(ina!=inb){
    var cut:VsmTCorner;
    if(ina){cut=vsmTCut(a,b);}else{cut=vsmTCut(b,a);}
    out.h[out.count]=cut.h;out.uv[out.count]=cut.uv;out.count++;
   }
  }
 }
 let scale=f32(VSM_LEVEL0_TEXELS>>((view>>16u)&7u));
 var lo=vec2f(FLOAT32_MAX);var hi=vec2f(-FLOAT32_MAX);
 for(var i=0u;i<out.count;i++){let v=vsmTTexel(out.h[i],scale,vec2f(0.0));lo=min(lo,v);hi=max(hi,v);}
 out.box=vec4f(lo,hi);
 return out;
}
var<workgroup> tris:array<VsmTTri,${VSM_TRANSMISSION_COMMAND_GROUP}>;
var<workgroup> wgCommand:array<u32,5>;
@compute @workgroup_size(${VSM_TRANSMISSION_COMMAND_GROUP}) fn vsmTransmissionBin(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u);
 if(index>=frame.cmds){return;}
 if(lane==0u){
  for(var j=0u;j<4u;j++){wgCommand[j]=list[4u*index+j];}
  wgCommand[4]=select(0u,pages[wgCommand[0]].indexCount/3u,wgCommand[3]>0u);
 }
 let triangles=workgroupUniformLoad(&wgCommand[4]);
 if(triangles==0u){return;}
 let row=wgCommand[0];let view=wgCommand[1];let first=wgCommand[2];let found=wgCommand[3];
 let page=pages[row];
 let raw=vsmProjectionData[view&0xFFFFu];
 let h=pageHeaderFor(page,(page.flags&${FLAG_HAS_UV}u)!=0u);
 let scale=f32(VSM_LEVEL0_TEXELS>>((view>>16u)&7u));
 for(var batch=0u;batch<triangles;batch+=${VSM_TRANSMISSION_COMMAND_GROUP}u){
  var tri:VsmTTri;
  if(batch+lane<triangles){tri=vsmTProject(page,h,batch+lane,view,raw);}
  tris[lane]=tri;
  workgroupBarrier();
  let n=min(${VSM_TRANSMISSION_COMMAND_GROUP}u,triangles-batch);
  for(var w=lane;w<found*n;w+=${VSM_TRANSMISSION_COMMAND_GROUP}u){
   let p=w/n;let i=w-p*n;
   if(tris[i].count<3u){continue;}
   let e=4u*frame.cmds+2u*(first+p);
   let v=list[e+1u];
   let corner=f32(VSM_PAGE_TEXELS)*vec2f(f32(v&0xFFu),f32((v>>8u)&0xFFu));
   let b=tris[i].box;
   if(b.z<corner.x-1.0||b.w<corner.y-1.0||b.x>=corner.x+${VSM_PAGE_TEXELS + 1}.0||b.y>=corner.y+${VSM_PAGE_TEXELS + 1}.0){continue;}
   var t=tris[i];
   for(var f=1u;f+1u<t.count;f++){
    let c=array<VsmTCorner,3>(VsmTCorner(t.h[0],t.uv[0]),VsmTCorner(t.h[f],t.uv[f]),VsmTCorner(t.h[f+1u],t.uv[f+1u]));
    let x=array<vec2f,3>(vsmTTexel(c[0].h,scale,corner),vsmTTexel(c[1].h,scale,corner),vsmTTexel(c[2].h,scale,corner));
    vsmTRecord(page,row,list[e],x,c,t.shape,t.q,t.ray);
   }
  }
  workgroupBarrier();
 }
}
`,
    [
      PAGE_INFO_WGSL,
      tilePoolWgsl('0.0'),
      COLOR_SAMPLE_WGSL,
      maskAlphaWgsl(true),
      MASK_KEEP_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      frameWgsl(layout),
      VSM_TRANSMISSION_COVER_WGSL,
      matrixWindingCw,
      PAGE_GEOMETRY_WGSL,
      BLEND_TRANSMITTANCE_WGSL,
      FLOAT32_MAX,
    ],
  )

// ---- Number, place, resolve, headers -----------------------------------------------------------

/**
 * `vsmTransmissionNumber`, one group: over the dirty list, each stamped slice with a record takes
 * this frame's number k (in list order, by a prefix sum in the group) and its first place in the
 * order (the records before it); then the dispatches of the place (a thread a record), the resolve
 * (a group a numbered slice) and the headers (a thread a dirty slice). Group 0: 0 frame uniform,
 * 1 build buffer, 2 the dispatch arguments.
 */
export const vsmTransmissionNumberWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(0) @binding(0) var<uniform> frame:VsmTransmissionFrame;
@group(0) @binding(1) var<storage,read_write> build:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
var<workgroup> sums:array<vec2u,${VSM_TRANSMISSION_PAGE_GROUP}>;
/** Records slice \`key\` holds this frame: none unless the clear stamped it. */
fn vsmTRecordsOf(key:u32)->u32{
 if(atomicLoad(&build[VSM_T_STAMPS+key])!=frame.stamp){return 0u;}
 return atomicLoad(&build[VSM_T_COUNTS+key]);
}
@compute @workgroup_size(${VSM_TRANSMISSION_PAGE_GROUP}) fn vsmTransmissionNumber(@builtin(local_invocation_index) lane:u32){
 let dirty=min(atomicLoad(&build[VSM_TC_DIRTY]),VSM_T_KEY_COUNT);
 let per=(dirty+${VSM_TRANSMISSION_PAGE_GROUP - 1}u)/${VSM_TRANSMISSION_PAGE_GROUP}u;
 let lo=min(lane*per,dirty);let hi=min(lo+per,dirty);
 var own=vec2u(0u);
 for(var i=lo;i<hi;i++){
  let r=vsmTRecordsOf(atomicLoad(&build[VSM_T_DIRTY+i]));
  if(r>0u){own+=vec2u(1u,r);}
 }
 sums[lane]=own;
 workgroupBarrier();
 for(var d=1u;d<${VSM_TRANSMISSION_PAGE_GROUP}u;d<<=1u){
  var add=vec2u(0u);
  if(lane>=d){add=sums[lane-d];}
  workgroupBarrier();
  sums[lane]+=add;
  workgroupBarrier();
 }
 var at=sums[lane]-own;
 for(var i=lo;i<hi;i++){
  let key=atomicLoad(&build[VSM_T_DIRTY+i]);
  let r=vsmTRecordsOf(key);
  if(r==0u){continue;}
  atomicStore(&build[VSM_T_KEYS+at.x],key);
  atomicStore(&build[VSM_T_FIRST+key],at.y);
  at+=vec2u(1u,r);
 }
 if(lane==${VSM_TRANSMISSION_PAGE_GROUP - 1}u){
  let total=sums[lane];
  atomicStore(&build[VSM_TC_SLICES],total.x);
  vsmTArgs(0u,(total.y+${VSM_TRANSMISSION_PAGE_GROUP - 1}u)/${VSM_TRANSMISSION_PAGE_GROUP}u);
  vsmTArgs(3u,total.x);
  vsmTArgs(6u,(dirty+${VSM_TRANSMISSION_PAGE_GROUP - 1}u)/${VSM_TRANSMISSION_PAGE_GROUP}u);
 }
}
`,
    [frameWgsl(layout), ARGS_WGSL],
  )
/** `vsmTransmissionPlace`, a thread a record: its index in the order, at its slice's first place
 *  plus its own. Group 0: 0 frame uniform, 1 build buffer. */
export const vsmTransmissionPlaceWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(0) @binding(0) var<uniform> frame:VsmTransmissionFrame;
@group(0) @binding(1) var<storage,read_write> build:array<u32>;
@compute @workgroup_size(${VSM_TRANSMISSION_PAGE_GROUP}) fn vsmTransmissionPlace(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let g=flatIndex(wid,nwg,1u)*${VSM_TRANSMISSION_PAGE_GROUP}u+lane;
 if(g>=min(build[VSM_TC_RECORDS],frame.records)){return;}
 let r=frame.regionRecords+g*VSM_T_RECORD_WORDS;
 build[VSM_T_ORDER+build[VSM_T_FIRST+build[r+16u]]+build[r+17u]]=g;
}
`,
    [frameWgsl(layout)],
  )

/**
 * `vsmTransmissionResolve`, a group of 256 per slice numbered this frame, a thread per cell: its
 * records read from the order into the group's memory, 256 at a time; each cell counts those that
 * may cover it (the record's cell range, then \`vsmTCoversCell\`); a prefix sum places the lists
 * after the records; the slice takes ⌈texels / 512⌉ blocks from the pool and chains them; the
 * cell headers, the chain and the lists (each entry its record's texel in the slice, in the order)
 * are written, then the records (a thread each) and their patches. A slice past
 * \`VSM_TRANSMISSION_CHAIN\` blocks (\`full\`), or one the pool cannot hold (\`blocksShort\`, its
 * blocks), is counted and left without (its shadow uncoloured this frame; the host grows the pool
 * and redraws the world).
 * \`vsmTransmissionHeaders\`, a thread per dirty slice: its page header texel from the table.
 * Group 0: 0 frame uniform, 1 build buffer, 2 table, 3 pool, 4 links, 5 the memory (storage).
 */
export const vsmTransmissionResolveWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(0) @binding(0) var<uniform> frame:VsmTransmissionFrame;
@group(0) @binding(1) var<storage,read_write> build:array<atomic<u32>>;
fn vsmTBuild(i:u32)->u32{return atomicLoad(&build[i]);}
${transmissionTables(0, 2)}
@group(0) @binding(5) var memory:texture_storage_2d<${VSM_TRANSMISSION_FORMAT},write>;
/** A record as the cells read it: its corners in page texels and its cells (\`vsmTCellsWord\`). */
struct VsmTStaged{a:vec2f,b:vec2f,c:vec2f,cells:u32,}
var<workgroup> staged:array<VsmTStaged,${CELL_COUNT}>;
var<workgroup> sums:array<u32,${CELL_COUNT}>;
var<workgroup> counts:array<u32,${CELL_COUNT}>;
var<workgroup> chain:array<u32,${VSM_TRANSMISSION_CHAIN}>;
var<workgroup> held:array<u32,3>;
/** Slice texel \`v\` in the memory, through the workgroup's chain. */
fn vsmTAt(v:u32)->vec2u{return vsmTBlockTexel(chain[v/VSM_T_BLOCK_TEXELS],v%VSM_T_BLOCK_TEXELS);}
fn vsmTRecordWord(g:u32,w:u32)->u32{return vsmTBuild(frame.regionRecords+g*VSM_T_RECORD_WORDS+w);}
/** Record \`batch + lane\` of the slice into the group's memory. */
fn vsmTStage(first:u32,batch:u32,records:u32,lane:u32){
 if(batch+lane>=records){return;}
 let g=vsmTBuild(VSM_T_ORDER+first+batch+lane);
 let f=vec4f(bitcast<f32>(vsmTRecordWord(g,0u)),bitcast<f32>(vsmTRecordWord(g,1u)),bitcast<f32>(vsmTRecordWord(g,2u)),bitcast<f32>(vsmTRecordWord(g,3u)));
 staged[lane]=VsmTStaged(f.xy,f.zw,vec2f(bitcast<f32>(vsmTRecordWord(g,4u)),bitcast<f32>(vsmTRecordWord(g,5u))),vsmTRecordWord(g,19u));
}
/** Whether staged record \`s\` may cover \`cell\`: within its range, then the bin's cover test. */
fn vsmTCovered(s:VsmTStaged,cell:vec2u)->bool{
 let r=vec4u(s.cells&15u,(s.cells>>4u)&15u,(s.cells>>8u)&15u,(s.cells>>12u)&15u);
 if(any(cell<r.xy)||any(cell>r.zw)){return false;}
 return vsmTCoversCell(s.a,s.b,s.c,select(1.0,-1.0,(s.cells&${CLOCKWISE_BIT}u)!=0u),vec2f(cell));
}
/** Record \`g\`, the slice's \`i\`th, into its four texels; its patch after the lists. */
fn vsmTCopy(g:u32,i:u32,patches:u32){
 let v=VSM_T_RECORDS_TEXEL+4u*i;
 let textured=(vsmTRecordWord(g,10u)&${TEXTURED_BIT}u)!=0u;
 let patchWord=4u*patches+vsmTRecordWord(g,12u);
 for(var t=0u;t<4u;t++){
  var w=vec4u(vsmTRecordWord(g,4u*t),vsmTRecordWord(g,4u*t+1u),vsmTRecordWord(g,4u*t+2u),vsmTRecordWord(g,4u*t+3u));
  if(t==3u){w.x=select(0u,patchWord,textured);}
  textureStore(memory,vsmTAt(v+t),w);
 }
 if(!textured){return;}
 let size=vsmTRecordWord(g,14u);
 let words=(size&0xFFFFu)*(size>>16u);
 let source=frame.regionPatches+vsmTRecordWord(g,18u);
 for(var j=0u;j<words;j+=4u){
  var w=vec4u(0u);
  for(var c=0u;c<4u;c++){if(j+c<words){w[c]=vsmTBuild(source+j+c);}}
  textureStore(memory,vsmTAt((patchWord+j)/4u),w);
 }
}
@compute @workgroup_size(${CELL_COUNT}) fn vsmTransmissionResolve(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let k=flatIndex(wid,nwg,1u);
 if(lane==0u){
  held[0]=0u;held[1]=0u;
  if(k<vsmTBuild(VSM_TC_SLICES)){held[1]=vsmTBuild(VSM_T_KEYS+k);held[0]=vsmTBuild(VSM_T_COUNTS+held[1]);}
 }
 let records=workgroupUniformLoad(&held[0]);
 if(records==0u){return;}
 let key=held[1];
 let first=vsmTBuild(VSM_T_FIRST+key);
 let cell=vec2u(lane%${VSM_TRANSMISSION_CELLS}u,lane/${VSM_TRANSMISSION_CELLS}u);
 // This cell's records, counted.
 var count=0u;
 for(var batch=0u;batch<records;batch+=${CELL_COUNT}u){
  vsmTStage(first,batch,records,lane);
  workgroupBarrier();
  let n=min(${CELL_COUNT}u,records-batch);
  for(var j=0u;j<n;j++){if(vsmTCovered(staged[j],cell)){count++;}}
  workgroupBarrier();
 }
 count=min(count,0xFFFFu);
 let texels=(count+3u)/4u;
 counts[lane]=count;
 sums[lane]=texels;
 workgroupBarrier();
 for(var d=1u;d<${CELL_COUNT}u;d<<=1u){
  var add=0u;
  if(lane>=d){add=sums[lane-d];}
  workgroupBarrier();
  sums[lane]+=add;
  workgroupBarrier();
 }
 let lists=VSM_T_RECORDS_TEXEL+4u*records;
 let patches=lists+sums[${CELL_COUNT - 1}u];
 let total=patches+(vsmTBuild(VSM_T_PATCH+key)+3u)/4u;
 let blocks=(total+VSM_T_BLOCK_TEXELS-1u)/VSM_T_BLOCK_TEXELS;
 if(lane==0u){
  held[2]=0u;
  if(blocks>VSM_T_CHAIN){atomicAdd(&build[VSM_TC_FULL],1u);}
  else{
   // Taken by compare-exchange: a count never moves below what is free, so a group that finds
   // the pool short leaves it as it was and every group that takes gets its own blocks.
   var free=atomicLoad(&pool[0]);
   loop{
    if(free<blocks){break;}
    let r=atomicCompareExchangeWeak(&pool[0],free,free-blocks);
    if(r.exchanged){held[2]=1u;break;}
    free=r.old_value;
   }
   if(held[2]==0u){atomicAdd(&build[VSM_TC_BLOCKSSHORT],blocks);}
   else{
    for(var j=0u;j<VSM_T_CHAIN;j++){
     var b=VSM_T_NONE;
     if(j<blocks){b=atomicLoad(&pool[2u+free-blocks+j]);}
     chain[j]=b;
    }
    for(var j=0u;j<blocks;j++){
     var next=VSM_T_NONE;
     if(j+1u<blocks){next=chain[j+1u];}
     links[chain[j]]=next;
    }
    table[key]=chain[0];
   }
  }
 }
 if(workgroupUniformLoad(&held[2])==0u){return;}
 // The cell headers, four a texel (first texel of the list << 16 | its count), and the chain.
 if(lane<${CELL_COUNT / 4}u){
  var h=vec4u(0u);
  for(var c=0u;c<4u;c++){
   let at=4u*lane+c;
   h[c]=((lists+sums[at]-(counts[at]+3u)/4u)<<16u)|counts[at];
  }
  textureStore(memory,vsmTAt(lane),h);
 }else if(lane<${RECORDS_TEXEL}u){
  let j=4u*(lane-${CELL_COUNT / 4}u);
  textureStore(memory,vsmTAt(lane),vec4u(chain[j],chain[j+1u],chain[j+2u],chain[j+3u]));
 }
 // This cell's list: each entry its record's first texel, padded to a texel. One batch of
 // records is still staged from the count.
 var at=lists+sums[lane]-texels;
 var entry=vec4u(0u);var filled=0u;var left=count;
 for(var batch=0u;batch<records;batch+=${CELL_COUNT}u){
  if(records>${CELL_COUNT}u){vsmTStage(first,batch,records,lane);}
  workgroupBarrier();
  let n=min(${CELL_COUNT}u,records-batch);
  for(var j=0u;j<n&&left>0u;j++){
   if(!vsmTCovered(staged[j],cell)){continue;}
   entry[filled]=VSM_T_RECORDS_TEXEL+4u*(batch+j);
   filled++;left--;
   if(filled==4u||left==0u){textureStore(memory,vsmTAt(at),entry);at++;filled=0u;entry=vec4u(0u);}
  }
  workgroupBarrier();
 }
 for(var i=lane;i<records;i+=${CELL_COUNT}u){vsmTCopy(vsmTBuild(VSM_T_ORDER+first+i),i,patches);}
}
@compute @workgroup_size(${VSM_TRANSMISSION_PAGE_GROUP}) fn vsmTransmissionHeaders(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=flatIndex(wid,nwg,1u)*${VSM_TRANSMISSION_PAGE_GROUP}u+lane;
 if(i>=vsmTBuild(VSM_TC_DIRTY)){return;}
 let t=vsmTBuild(VSM_T_DIRTY+i)>>2u;
 let w=vec4u(table[4u*t],table[4u*t+1u],table[4u*t+2u],table[4u*t+3u]);
 textureStore(memory,vec2u(t%${VSM_TRANSMISSION_WIDTH}u,t/${VSM_TRANSMISSION_WIDTH}u),w);
}
`,
    [frameWgsl(layout), VSM_TRANSMISSION_COVER_WGSL],
  )

// ---- Consumer read ------------------------------------------------------------------------------

/**
 * The read of every shadow consumer (`../lighting/direct/shadowWgsl.ts`): the memory at `binding`
 * (a one-texel stand-in without translucent casters), then `vsmTransmissionThrough` — what the
 * translucent triangles of the sample's page let through to the receiver, tested exactly: its cell
 * of the page where the sample `sm` falls, each listed triangle containing that point
 * (`vsmTInside`) and lying strictly toward the light from the receiver. Directional: the triangle's
 * position along the map's unit axis at the point, barycentric, against the receiver's, by more
 * than ε = 2⁻²⁰ of the larger (f32 rounds each about eight times: 2⁻²¹, doubled); local: the
 * fraction of the way from the receiver to the light where the ray meets the triangle's plane,
 * above ε = 2⁻²⁰ of the larger of |P| and |w| over |n·P|. The receiver is the point read's own,
 * moved off its surface by the normal bias: a surface's own triangle is never above it. Up to two
 * crossings multiply in any order to the same bits; three or more multiply in increasing distance
 * (then by their quantised value), so the result is the same whatever the list order.
 * Needs `VsmMapRead`, `vsmProjectionOf`, the VSM constants and uniforms (`vsm`), and the maths
 * library's `bilinear3`, which it lists.
 */
export const vsmTransmissionReadWgsl = (binding: number) =>
  wgslBlock(
    `vsmTransmissionReadWgsl(${binding})`,
    [VSM_TRANSMISSION_EDGE_WGSL, bilinear3],
    `
@group(0) @binding(${binding}) var vsmTransmissionMemory:texture_2d_array<u32>;
fn vsmTLoad(t:vec2u)->vec4u{return textureLoad(vsmTransmissionMemory,t,0,0);}
/** The block of slice texel \`v\` from its first block \`b0\`, the chain read from the first block. */
fn vsmTBlock(b0:u32,v:u32)->u32{
 let j=v>>${BLOCK_SHIFT}u;
 var b=b0;
 if(j>0u){b=vsmTLoad(vsmTMemBlock(b0,${HEADER_TEXELS}u+(j>>2u)))[j&3u];}
 return b;
}
/** Slice texel \`v\` from its first block \`b0\`. */
fn vsmTRead(b0:u32,v:u32)->vec4u{
 return vsmTLoad(vsmTMemBlock(vsmTBlock(b0,v),v&${VSM_TRANSMISSION_BLOCK_TEXELS - 1}u));
}
fn vsmTMemBlock(b:u32,t:u32)->vec2u{
 return vec2u((b&1u)*${VSM_TRANSMISSION_BLOCK_TEXELS}u+t,((vsm.poolPages+${2 * VSM_TRANSMISSION_WIDTH - 1}u)>>${HEADER_SHIFT}u)+(b>>1u));
}
/** The two first blocks (dynamic, static) of physical page \`page\`: none both without translucent
 *  casters (the one-texel stand-in). */
fn vsmTransmissionBlocks(page:vec2u)->vec2u{
 if(textureDimensions(vsmTransmissionMemory).x<=1u){return vec2u(${VSM_TRANSMISSION_NONE}u);}
 let index=page.y*vsm.poolPagesXY.x+page.x;
 let t=index>>1u;
 let w=vsmTLoad(vec2u(t&${VSM_TRANSMISSION_WIDTH - 1}u,t>>${WIDTH_SHIFT}u));
 return select(w.xy,w.zw,(index&1u)!=0u);
}
/** The receiver: the point on the page, and its position along the axis (directional) or its
 *  light-relative position (local). */
struct VsmTReceiver{p:vec2f,directional:bool,axis:vec3f,d:f32,at:vec3f,}
/** One crossing of record \`v\`: its distance from the receiver toward the light (+inf for none) and
 *  what it lets through. */
struct VsmTHit{distance:f32,key:f32,through:vec3f,}
fn vsmTHitOf(b0:u32,v:u32,r:VsmTReceiver)->VsmTHit{
 var none=VsmTHit(-1.0,0.0,vec3f(1.0));
 // The record's four texels lie in one block: records start on a multiple of four texels, and a
 // block holds a whole number of them. Its block is read from the chain once.
 let rb=vsmTBlock(b0,v);let rv=v&${VSM_TRANSMISSION_BLOCK_TEXELS - 1}u;
 let t0=bitcast<vec4f>(vsmTLoad(vsmTMemBlock(rb,rv)));let t1=bitcast<vec4f>(vsmTLoad(vsmTMemBlock(rb,rv+1u)));
 let a=t0.xy;let b=t0.zw;let c=t1.xy;
 if(!vsmTInside(a,b,c,r.p)){return none;}
 let t2=vsmTLoad(vsmTMemBlock(rb,rv+2u));
 var distance=0.0;
 if(r.directional){
  let hit=dot(vsmTWeights(a,b,c,r.p),vec3f(t1.zw,bitcast<f32>(t2.x)));
  distance=hit-r.d;
  if(!(distance>${2 ** -20}*max(abs(hit),abs(r.d)))){return none;}
 }else{
  let n=vec3f(t1.zw,bitcast<f32>(t2.x));let w=bitcast<f32>(t2.y);
  let along=dot(n,r.at);
  if(along==0.0){return none;}
  distance=(along-w)/along;
  if(!(distance>${2 ** -20}*max(length(r.at),abs(w))/abs(along))){return none;}
 }
 var q=t2.z;
 var through=vec3f(1.0);
 if((q&${TEXTURED_BIT}u)!=0u){
  // A textured caster: the four patch texels around the point, bilinear.
  let d=vsmTLoad(vsmTMemBlock(rb,rv+3u));
  let origin=vec2f(vec2i(vec2u(d.y&0xFFFFu,d.y>>16u))-vec2i(1));
  let size=vec2u(d.z&0xFFFFu,d.z>>16u);
  let h=clamp(r.p-0.5-origin,vec2f(0.0),vec2f(size-vec2u(1u)));
  let i=vec2u(floor(h));let f=h-floor(h);
  let j=min(i+1u,size-vec2u(1u));
  let ta=vsmTPatch(b0,d.x,size.x,i);let tb=vsmTPatch(b0,d.x,size.x,vec2u(j.x,i.y));
  let tc=vsmTPatch(b0,d.x,size.x,vec2u(i.x,j.y));let td=vsmTPatch(b0,d.x,size.x,j);
  through=bilinear3(ta,tb,tc,td,f);
  q=0u;
 }else{through=1.0-unpack4x8unorm(q).rgb;}
 return VsmTHit(distance,f32(q&0xFFFFFFu),through);
}
fn vsmTPatch(b0:u32,first:u32,width:u32,t:vec2u)->vec3f{
 let word=first+t.y*width+t.x;
 return 1.0-unpack4x8unorm(vsmTRead(b0,word>>2u)[word&3u]).rgb;
}
/** Over slice \`b0\`'s cell list at the receiver: the crossings counted and multiplied in list order,
 *  and the least crossing ordered after \`after\` (distance, then key), its multiplicity and value. */
struct VsmTScan{count:u32,product:vec3f,next:vec2f,nextCount:u32,nextThrough:vec3f,}
fn vsmTLess(a:vec2f,b:vec2f)->bool{return a.x<b.x||(a.x==b.x&&a.y<b.y);}
fn vsmTScanSlice(b0:u32,r:VsmTReceiver,after:vec2f,scan:VsmTScan)->VsmTScan{
 var out=scan;
 let cell=min(vec2u(r.p/${VSM_TRANSMISSION_CELL}.0),vec2u(${VSM_TRANSMISSION_CELLS - 1}u));
 let index=cell.y*${VSM_TRANSMISSION_CELLS}u+cell.x;
 let header=vsmTRead(b0,index>>2u)[index&3u];
 let first=header>>16u;let count=header&0xFFFFu;
 // Four entries a texel: each texel read once.
 var entries=vec4u(0u);
 for(var i=0u;i<count;i++){
  if((i&3u)==0u){entries=vsmTRead(b0,first+(i>>2u));}
  let v=entries[i&3u];
  let hit=vsmTHitOf(b0,v,r);
  if(hit.distance<0.0){continue;}
  out.count++;out.product=out.product*hit.through;
  let key=vec2f(hit.distance,hit.key);
  if(!vsmTLess(after,key)){continue;}
  if(out.nextCount==0u||vsmTLess(key,out.next)){out.next=key;out.nextCount=1u;out.nextThrough=hit.through;}
  else if(all(key==out.next)){out.nextCount++;}
 }
 return out;
}
fn vsmTScanPage(blocks:vec2u,r:VsmTReceiver,after:vec2f)->VsmTScan{
 var scan=VsmTScan(0u,vec3f(1.0),vec2f(0.0),0u,vec3f(1.0));
 if(blocks.x!=${VSM_TRANSMISSION_NONE}u){scan=vsmTScanSlice(blocks.x,r,after,scan);}
 if(blocks.y!=${VSM_TRANSMISSION_NONE}u){scan=vsmTScanSlice(blocks.y,r,after,scan);}
 return scan;
}
/** What the translucent casters let through to the receiver of sample \`sm\`: \`fromMap\` the
 *  receiver in the shifted space of the sample's map (local), \`fromEye\` + \`eye\` its world
 *  position (directional). The axis is the sample's own level's, as its records were binned. */
fn vsmTransmissionThrough(sm:VsmMapRead,fromMap:vec3f,fromEye:vec3f,eye:vec3f,directional:bool)->vec3f{
 let blocks=vsmTransmissionBlocks(sm.poolTexel>>vec2u(${floorLog2(VSM_PAGE_TEXELS)}u));
 if(all(blocks==vec2u(${VSM_TRANSMISSION_NONE}u))){return vec3f(1.0);}
 let M=vsmProjectionOf(sm.handle).shiftedToMapUv;
 let axis=normalize(vec3f(M[0].z,M[1].z,M[2].z));
 let r=VsmTReceiver(vec2f(sm.poolTexel&vec2u(${VSM_PAGE_TEXELS - 1}u))+fract(sm.mapTexelPos),directional,axis,dot(fromEye,axis)+dot(eye,axis),fromMap);
 let first=vsmTScanPage(blocks,r,vec2f(-1.0));
 if(first.count<=2u){return first.product;}
 var through=vec3f(1.0);var done=0u;var after=vec2f(-1.0);
 for(var guard=0u;done<first.count&&guard<first.count;guard++){
  let s=vsmTScanPage(blocks,r,after);
  if(s.nextCount==0u){break;}
  for(var m=0u;m<s.nextCount;m++){through*=s.nextThrough;}
  done+=s.nextCount;after=s.next;
 }
 return through;
}
/** Whether sample \`sm\` lies in a page with a translucent slice. */
fn vsmTransmissionPaned(sm:VsmMapRead)->bool{
 return sm.valid&&any(vsmTransmissionBlocks(sm.poolTexel>>vec2u(${floorLog2(VSM_PAGE_TEXELS)}u))!=vec2u(${VSM_TRANSMISSION_NONE}u));
}`,
  )
