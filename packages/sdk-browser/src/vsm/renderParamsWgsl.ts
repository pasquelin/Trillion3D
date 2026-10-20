import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { ceilDivWgsl } from '../../../math/src/wgsl/integer.ts'
import { fieldLayout } from '../gpu/core/fieldLayout.ts'
import { GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'

/** THE NON-CLUSTER RASTER'S PARAMETERS AND INDIRECT ARGUMENTS (`renderCullWgsl.ts`): its chunk's
 *  uniform, its counters and the one-thread kernels that arm each next stage. */

/** The raster's corner tiers: tier t draws `VSM_RENDER_TIER_CORNERS << t` corners a pair, a row
 *  taking the least tier that holds its corners (`vsmRenderTierOf`) — at most 256 triangles a
 *  row, twice for a two-sided row: 1536 corners, the last tier's. */
export const VSM_RENDER_CORNER_TIERS = 5
export const VSM_RENDER_TIER_CORNERS = 96
/** Then the voxel rows' tiers (`FLAG_VOXEL`), from `VSM_RENDER_VOXEL_TIER`: their pairs are drawn
 *  by the voxel raster (`renderVoxelWgsl.ts`), tier `VSM_RENDER_VOXEL_TIER + t` drawing
 *  `VSM_RENDER_TIER_CORNERS << t` corners a pair as corner tier `t` does — a page's bricks' boxes,
 *  one-sided, 36 corners a brick, 756 for its 21 at most: no pair launches more than twice the
 *  corners its page draws, nor fewer than 96 —, and only on a frame whose table holds a voxel row
 *  (`vsmEncodeChunks`). A candidate says it is one by `VSM_RENDER_VOXEL_BIT` in its corners, above
 *  any count a row draws. */
export const VSM_RENDER_VOXEL_TIER = VSM_RENDER_CORNER_TIERS
export const VSM_RENDER_VOXEL_TIERS = 4
export const VSM_RENDER_VOXEL_BIT = 0x8000
export const VSM_RENDER_TIERS = VSM_RENDER_CORNER_TIERS + VSM_RENDER_VOXEL_TIERS
/** The corners a pair of tier `tier` draws. */
export const vsmRenderTierCorners = (tier: number) =>
  VSM_RENDER_TIER_CORNERS << (tier >= VSM_RENDER_VOXEL_TIER ? tier - VSM_RENDER_VOXEL_TIER : tier)
/** Words per chunk in the indirect argument buffer, by dispatch: the cull's 3; a workgroup a command
 *  3 (the transmission's page list); the bin's 3, a thread a command (`vsmRenderBin`); then 3 a
 *  tier's expand, a workgroup a command of the tier; then a draw of 4 a tier. */
export const VSM_RENDER_ARGS_CULL = 0
export const VSM_RENDER_ARGS_EXPAND = 3
export const VSM_RENDER_ARGS_BIN = 6
export const VSM_RENDER_ARGS_TIER_EXPAND = 9
export const VSM_RENDER_ARGS_DRAW = VSM_RENDER_ARGS_TIER_EXPAND + 3 * VSM_RENDER_TIERS
export const VSM_RENDER_ARGS_STRIDE_WORDS = VSM_RENDER_ARGS_DRAW + 4 * VSM_RENDER_TIERS
/** Counter words: [0] candidates, [1] the views the GPU listed (`renderViewsWgsl.ts`), then
 *  `VSM_RENDER_CHUNK_COUNTS` per chunk from word 4: commands, then each tier's pairs, commands
 *  and bin cursor (`VSM_RENDER_TIER_PAIRS`, `_CMDS`, `_CURSOR` + tier). */
export const VSM_RENDER_COUNTS_HEAD = 4
export const VSM_RENDER_TIER_PAIRS = 1
export const VSM_RENDER_TIER_CMDS = VSM_RENDER_TIER_PAIRS + VSM_RENDER_TIERS
const VSM_RENDER_TIER_CURSOR = VSM_RENDER_TIER_CMDS + VSM_RENDER_TIERS
export const VSM_RENDER_CHUNK_COUNTS = VSM_RENDER_TIER_CURSOR + VSM_RENDER_TIERS
const VSM_RENDER_COUNT_VIEWS = 1
/** Map view flag: directional (clipmap level, 1 mip, clamp to near plane — the near-plane clamp). */
const VSM_RENDER_VIEW_DIRECTIONAL = 1

/**
 * Per-chunk parameters (one slot each, the device's `uniformStride` apart, same frame values in
 * every slot), in one table: the struct the kernels read and the words the host writes
 * (`vsmWriteChunkParams`, `chunkParams.ts`). The camera is the main view whose level of detail the casters take: eye (split
 * double), world-to-view rotation rows (engine convention, −Z forward), focal in pixels, near,
 * perspective 0/1, the cut's threshold.
 */
export const VSM_RENDER_PARAMS = fieldLayout('VsmRenderParams', [
  ['eyeHigh', 'vec3f'],
  ['perspective', 'f32'],
  ['eyeLow', 'vec3f'],
  ['focal', 'f32'],
  ['viewRow0', 'vec4f'],
  ['viewRow1', 'vec4f'],
  ['viewRow2', 'vec4f'],
  ['near', 'f32'],
  ['threshold', 'f32'],
  ['rowCount', 'u32'],
  ['viewCount', 'u32'],
  ['chunk', 'u32'],
  ['chunkFirst', 'u32'],
  ['chunkRows', 'u32'],
  ['chunkCount', 'u32'],
  ['cmdCapacity', 'u32'],
  ['pairCapacity', 'u32'],
] as const)
const VSM_RENDER_PARAMS_STRUCT_WGSL = wgslBlock(
  'VSM_RENDER_PARAMS_STRUCT_WGSL',
  [],
  VSM_RENDER_PARAMS.wgsl,
)
export const VSM_RENDER_PARAMS_WGSL = wgslBlock(
  'VSM_RENDER_PARAMS_WGSL',
  [VSM_RENDER_PARAMS_STRUCT_WGSL],
  `
/** A caster row the camera's cut selects: world sphere (centre high + radius, centre low), its row,
 *  corners and flags (bit 0 cache as dynamic, bit 1 deforming: it invalidates the pages it draws). */
struct VsmRenderCandidate{c:vec4f,l:vec3f,row:u32,corners:u32,flags:u32,}
const VSM_RENDER_CAND_DYNAMIC:u32=1u;
const VSM_RENDER_CAND_DEFORMING:u32=2u;
/** Bit 2: the row's triangles face the light clockwise in world space — a mirroring placement
 *  or a back-side row (\`FLAG_BACK\`), not both (\`vsmRenderAppendCandidate\`). */
const VSM_RENDER_CAND_FLIPPED:u32=4u;
${wgslConsts({
  VSM_RENDER_VIEW_DIRECTIONAL,
  VSM_RENDER_COUNTS_HEAD,
  VSM_RENDER_COUNT_VIEWS,
  VSM_RENDER_CHUNK_COUNTS,
  VSM_RENDER_TIER_PAIRS,
  VSM_RENDER_TIER_CMDS,
  VSM_RENDER_TIER_CURSOR,
  VSM_RENDER_TIERS,
  VSM_RENDER_TIER_CORNERS,
  VSM_RENDER_CORNER_TIERS,
  VSM_RENDER_VOXEL_TIER,
  VSM_RENDER_VOXEL_TIERS,
  VSM_RENDER_VOXEL_BIT,
})}
fn vsmRenderChunkCounter(chunk:u32,k:u32)->u32{return VSM_RENDER_COUNTS_HEAD+chunk*VSM_RENDER_CHUNK_COUNTS+k;}
/** The least tier whose pairs draw \`corners\` corners: \`VSM_RENDER_TIER_CORNERS << tier\` ≥ corners;
 *  a voxel row's (\`VSM_RENDER_VOXEL_BIT\`) the same among the voxel tiers. */
fn vsmRenderTierOf(corners:u32)->u32{
 let n=corners&(VSM_RENDER_VOXEL_BIT-1u);
 let q=max((n+VSM_RENDER_TIER_CORNERS-1u)/VSM_RENDER_TIER_CORNERS,1u);
 let t=select(firstLeadingBit(q-1u)+1u,0u,q==1u);
 if((corners&VSM_RENDER_VOXEL_BIT)!=0u){return VSM_RENDER_VOXEL_TIER+min(t,VSM_RENDER_VOXEL_TIERS-1u);}
 return min(t,VSM_RENDER_CORNER_TIERS-1u);
}
/** The corners a pair of tier \`tier\` draws (\`vsmRenderTierCorners\`). */
fn vsmRenderTierCorners(tier:u32)->u32{return VSM_RENDER_TIER_CORNERS<<select(tier,tier-VSM_RENDER_VOXEL_TIER,tier>=VSM_RENDER_VOXEL_TIER);}
`,
)

/**
 * One-thread kernels writing the next stage's indirect arguments. Group 0: 0 params, 1 counters
 * (rw atomic), 2 arguments (rw, `VSM_RENDER_ARGS_STRIDE_WORDS` per chunk).
 */
export const VSM_RENDER_ARGS_WGSL = wgslProgram(
  `
@group(0) @binding(0) var<uniform> params:VsmRenderParams;
@group(0) @binding(1) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;
fn vsmRenderArgsAt(chunk:u32,word:u32)->u32{return chunk*${VSM_RENDER_ARGS_STRIDE_WORDS}u+word;}
/** Cull dispatch of every chunk, once the candidates are known. */
@compute @workgroup_size(1) fn vsmRenderArgsCull(){
 let total=atomicLoad(&counts[0]);
 for(var c=0u;c<params.chunkCount;c++){
  let first=c*params.chunkRows;
  let n=select(0u,min(total-first,params.chunkRows),total>first);
  let at=vsmRenderArgsAt(c,${VSM_RENDER_ARGS_CULL}u);
  args[at]=ceilDiv(n,WORKGROUP_THREADS);
  args[at+1u]=select(0u,min(atomicLoad(&counts[VSM_RENDER_COUNT_VIEWS]),params.viewCount),n>0u);
  args[at+2u]=1u;
 }
}
fn vsmRenderArgsGrid(word:u32,groups:u32){
 let g=groupGrid(groups);
 let at=vsmRenderArgsAt(params.chunk,word);
 args[at]=g.x;args[at+1u]=g.y;args[at+2u]=1u;
}
/** The dispatches over this chunk's commands: a workgroup a command, the bin's thread a command,
 *  and each tier's expand, a workgroup a command of the tier — the tier's commands from its first
 *  in the bin's order (the lower tiers' counts summed, here once), where its cursor starts. */
@compute @workgroup_size(1) fn vsmRenderArgsExpand(){
 let n=min(atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,0u)]),params.cmdCapacity);
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_EXPAND}u,n);
 vsmRenderArgsGrid(${VSM_RENDER_ARGS_BIN}u,ceilDiv(n,WORKGROUP_THREADS));
 var first=0u;
 for(var t=0u;t<VSM_RENDER_TIERS;t++){
  let tierCmds=atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,VSM_RENDER_TIER_CMDS+t)]);
  atomicStore(&counts[vsmRenderChunkCounter(params.chunk,VSM_RENDER_TIER_CURSOR+t)],first);
  vsmRenderArgsGrid(${VSM_RENDER_ARGS_TIER_EXPAND}u+3u*t,tierCmds);
  first+=tierCmds;
 }
}
/** The draws of this chunk, one a tier: its pairs lie after the lower tiers' in the list
 *  (\`vsmRenderExpand\`), each drawn by its tier's corners — vertex k of pair p is vertex
 *  p · corners + k of one instance, so a draw starts at its first pair by its first vertex. */
@compute @workgroup_size(1) fn vsmRenderArgsDraw(){
 var first=0u;
 for(var t=0u;t<VSM_RENDER_TIERS;t++){
  let next=first+atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,VSM_RENDER_TIER_PAIRS+t)]);
  let start=min(first,params.pairCapacity);
  let end=min(next,params.pairCapacity);
  let corners=vsmRenderTierCorners(t);
  let at=vsmRenderArgsAt(params.chunk,${VSM_RENDER_ARGS_DRAW}u+4u*t);
  args[at]=(end-start)*corners;args[at+1u]=1u;args[at+2u]=start*corners;args[at+3u]=0u;
  first=next;
 }
}
`,
  [VSM_RENDER_PARAMS_WGSL, GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL, ceilDivWgsl],
)
