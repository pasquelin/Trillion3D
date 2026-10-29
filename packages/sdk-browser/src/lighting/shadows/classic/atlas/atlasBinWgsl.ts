/**
 * THE ATLAS DRAWS' SECOND SORT (`shadowVirtualEnable` off). The cull's bin sorted the casters' records by tier (`vsmRenderBin`); the atlas draws each atlas page and layer in a render
 * pass of its own, so the records are sorted again, by (tier, page, layer) — the texture layer of the tile their map lies in —, as the reference binds the casters of each shadow
 * depth target to the pass that draws it: a pass draws only its records, none is read and dropped by another's vertex stage. Records whose map has no tile, whose mip is not the
 * tile's, or that are a movable caster's in a map that leaves them out are left out of the sort, so no pass draws them.
 *
 * Three kernels over the sorted list (`binRecords`), with the main draw arguments (`binArgs`: where each tier's records lie):
 * - `vsmAtlasBinCount`: a thread a record, the count of its slot (`tier * buckets + bucket`);
 * - `vsmAtlasBinOffsets`: one thread, each slot's first place in the second list and its draw arguments (`binDraws`, four words a slot as the main draws have them);
 * - `vsmAtlasBinScatter`: a thread a record, its place in the second list (`binSorted`).
 * `binCounts` holds the slots' counts, then their cursors. Group 0: 0 the atlas buffer, 1 the main draw arguments, 2 the sorted records, 3 the counts (rw atomic), 4 the second list (rw),
 * 5 the second draw arguments (rw). `ATLAS_BUCKETS`: the texture layers (pages by layers); `ATLAS_LAYERS`: the layers a page has.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { VSM_CONSTANTS_WGSL } from '../../vsm/constants.ts'
import {
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_RECORD_WGSL,
  vsmRenderTierCorners,
  vsmRenderTierFamily,
  VSM_RENDER_FAMILY,
} from '../../vsm/render/renderParamsWgsl.ts'
import { TIERS } from '../../vsm/render/renderPipes.ts'
import { atlasTileWgsl } from './atlasTileWgsl.ts'

/** The tiers the atlas draws (the voxel rows keep the pool raster), lowest first: the slots of the second sort are laid tier by tier. */
export const ATLAS_BIN_TIERS = TIERS.filter(
  (t) => vsmRenderTierFamily(t) !== VSM_RENDER_FAMILY.voxel,
)
export const ATLAS_BIN_COUNT_ENTRY = 'vsmAtlasBinCount'
export const ATLAS_BIN_OFFSETS_ENTRY = 'vsmAtlasBinOffsets'
export const ATLAS_BIN_SCATTER_ENTRY = 'vsmAtlasBinScatter'
/** The binding of the atlas buffer in group 0. */
export const ATLAS_BIN_ATLAS_BINDING = 0

/** The words of the counts for `buckets` texture layers: the slots' counts, then their cursors. */
export const atlasBinCountWords = (buckets: number) => 2 * ATLAS_BIN_TIERS.length * buckets

/** The second draw arguments' word of tier `tier` (its index among `ATLAS_BIN_TIERS`) and texture layer `layer` of `buckets`, in bytes. */
export const atlasBinDrawOffset = (tier: number, layer: number, buckets: number) =>
  (tier * buckets + layer) * 16

export const vsmAtlasBinWgsl = () =>
  wgslProgram(
    /* wgsl */ `
override ATLAS_BUCKETS:u32=1u;
override ATLAS_LAYERS:u32=1u;
const ATLAS_BIN_TIERS:u32=${ATLAS_BIN_TIERS.length}u;
const ATLAS_BIN_NONE:u32=0xFFFFFFFFu;
var<private> ATLAS_BIN_CORNERS=array<u32,${ATLAS_BIN_TIERS.length}>(${ATLAS_BIN_TIERS.map((t) => `${vsmRenderTierCorners(t)}u`).join(',')});
@group(0) @binding(1) var<storage,read> binArgs:array<u32>;
@group(0) @binding(2) var<storage,read> binRecords:array<vec4u>;
@group(0) @binding(3) var<storage,read_write> binCounts:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> binSorted:array<vec4u>;
@group(0) @binding(5) var<storage,read_write> binDraws:array<u32>;
/** The slot of the record at \`index\` of the sorted list: its tier (where the main draws put it) and the texture layer of its tile; none for a record no pass draws. */
fn vsmAtlasBinSlot(index:u32)->u32{
 var tier=ATLAS_BIN_TIERS;
 for(var t=0u;t<ATLAS_BIN_TIERS;t++){
  let corners=ATLAS_BIN_CORNERS[t];
  let first=binArgs[${VSM_RENDER_ARGS_DRAW}u+4u*t+2u]/corners;
  if(index>=first&&index<first+binArgs[${VSM_RENDER_ARGS_DRAW}u+4u*t]/corners){tier=t;}
 }
 if(tier==ATLAS_BIN_TIERS){return ATLAS_BIN_NONE;}
 let r=binRecords[index];
 let tile=vsmAtlasTileOf(vsmRecordMap(r));
 let layer=vsmRecordStatic(r);
 if(!tile.valid||vsmRecordMip(r)!=tile.mip||layer>=ATLAS_LAYERS||(tile.noDynamic&&layer==0u)){return ATLAS_BIN_NONE;}
 return tier*ATLAS_BUCKETS+tile.page*ATLAS_LAYERS+layer;
}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${ATLAS_BIN_COUNT_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let slot=vsmAtlasBinSlot(flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane);
 if(slot!=ATLAS_BIN_NONE){atomicAdd(&binCounts[slot],1u);}
}
@compute @workgroup_size(1) fn ${ATLAS_BIN_OFFSETS_ENTRY}(){
 var place=0u;
 for(var t=0u;t<ATLAS_BIN_TIERS;t++){
  for(var b=0u;b<ATLAS_BUCKETS;b++){
   let slot=t*ATLAS_BUCKETS+b;
   let n=atomicLoad(&binCounts[slot]);
   atomicStore(&binCounts[ATLAS_BIN_TIERS*ATLAS_BUCKETS+slot],place);
   binDraws[4u*slot]=n*ATLAS_BIN_CORNERS[t];binDraws[4u*slot+1u]=1u;binDraws[4u*slot+2u]=place*ATLAS_BIN_CORNERS[t];binDraws[4u*slot+3u]=0u;
   place+=n;
  }
 }
}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${ATLAS_BIN_SCATTER_ENTRY}(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 let slot=vsmAtlasBinSlot(index);
 if(slot!=ATLAS_BIN_NONE){binSorted[atomicAdd(&binCounts[ATLAS_BIN_TIERS*ATLAS_BUCKETS+slot],1u)]=binRecords[index];}
}`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_RENDER_RECORD_WGSL,
      atlasTileWgsl(0, ATLAS_BIN_ATLAS_BINDING),
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
