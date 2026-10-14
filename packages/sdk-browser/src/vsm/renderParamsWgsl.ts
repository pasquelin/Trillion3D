import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { ceilDivWgsl } from '../../../math/src/wgsl/integer.ts'
import { fieldLayout } from '../gpu/core/fieldLayout.ts'
import { GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'

/** THE NON-CLUSTER RASTER'S PARAMETERS AND INDIRECT ARGUMENTS (`renderCullWgsl.ts`): its chunk's
 *  uniform, its counters and the one-thread kernels that arm each next stage. */

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
  ['smallCasterSq', 'f32'],
  ['rowCount', 'u32'],
  ['viewCount', 'u32'],
  ['chunk', 'u32'],
  ['chunkFirst', 'u32'],
  ['chunkRows', 'u32'],
  ['chunkCount', 'u32'],
  ['cmdCapacity', 'u32'],
  ['pairCapacity', 'u32'],
  ['pad', 'u32'],
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
 *  corners, flags (bit 0 cache as dynamic, bit 1 deforming: it invalidates the pages it draws), and the radius of
 *  its whole object (f32 bits, 0 when unknown: the row's sphere stands in). */
struct VsmRenderCandidate{c:vec4f,l:vec3f,row:u32,corners:u32,flags:u32,objectRadius:u32,pad1:u32,}
const VSM_RENDER_CAND_DYNAMIC:u32=1u;
const VSM_RENDER_CAND_DEFORMING:u32=2u;
${wgslConsts({
  VSM_RENDER_VIEW_DIRECTIONAL,
  VSM_RENDER_COUNTS_HEAD,
})}
fn vsmRenderChunkCounter(chunk:u32,k:u32)->u32{return VSM_RENDER_COUNTS_HEAD+chunk*4u+k;}
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
  args[at+1u]=select(0u,params.viewCount,n>0u);
  args[at+2u]=1u;
 }
}
/** Expand dispatch of this chunk: one workgroup per command. */
@compute @workgroup_size(1) fn vsmRenderArgsExpand(){
 let n=min(atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,0u)]),params.cmdCapacity);
 let g=groupGrid(n);
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
`,
  [VSM_RENDER_PARAMS_WGSL, GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL, ceilDivWgsl],
)
