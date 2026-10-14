import { POOL_RANKS_WGSL } from './rankWgsl.ts'
import { POOL_LANES_WGSL, POOL_SORT_HEAD_WGSL } from './sort.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL } from '../dispatch/grid.ts'
import { LANE_SCAN_WGSL } from '../core/laneScanWgsl.ts'

/**
 * THE STABLE PLACEMENT of the pool sort (`sortWgsl.ts`), once the ranks are placed and the
 * boundary rank marked: `poolGroups` counts each group's slots above the boundary and at it,
 * `poolOffsets` gives each group its first index of either kind in slot order, `poolSpread` stages
 * the slots above the boundary at their index and lists the boundary's first ones, `poolScatter`
 * lists the staged slots, a chunk at a time, each at its rank's next place. No atomic decides a
 * place: within a rank, the lower slot first.
 */
export const POOL_SORT_STABLE_WGSL = wgslBlock(
  'POOL_SORT_STABLE_WGSL',
  [POOL_RANKS_WGSL, FLAT_INDEX_WGSL, POOL_LANES_WGSL, LANE_SCAN_WGSL, POOL_SORT_HEAD_WGSL],
  `/** The ranks of a group's slots, or of a chunk of the staged slots. */
var<workgroup> poolChunk:array<u32,POOL_LANES>;
var<workgroup> poolStaged:u32;
/** What the queue takes of a slot of rank \`rank\`: 1 staged, above the boundary; 2 the
 *  boundary's; 0 nothing. */
fn poolSlotPart(rank:u32,bound:u32)->u32{
 if(rank>=POOL_RANKS){return 0u;}
 if(rank==bound){return 2u;}
 return select(0u,1u,rank>bound||bound==POOL_RANKS);
}
/** Lane \`lane\`'s run of group \`g\`'s slots: how many are staged, how many the boundary's; their
 *  ranks kept in \`poolChunk\`. */
fn poolGroupRun(g:u32,lane:u32,bound:u32)->vec2u{
 let span=laneRun(lane,POOL_LANES);
 var parts=vec2u(0u,0u);
 for(var k=span.x;k<span.y;k++){
  let rank=poolSlotRank(g*POOL_LANES+k);poolChunk[k]=rank;
  let part=poolSlotPart(rank,bound);
  parts+=vec2u(select(0u,1u,part==1u),select(0u,1u,part==2u));
 }
 return parts;
}
/** Word \`half\` of group \`g\`'s two counts, then first indices, in the scratch. */
fn poolGroupAt(g:u32,half:u32)->u32{return 2u*poolBurst()+2u*g+half;}
@compute @workgroup_size(WORKGROUP_THREADS)
fn poolGroups(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let g=flatIndex(wid,n,1u);let parts=poolGroupRun(g,lane,poolCountLoad(POOL_BOUND));
 let staged=laneScan(lane,parts.x);
 workgroupBarrier();
 let bounded=laneScan(lane,parts.y);
 if(lane==WORKGROUP_THREADS-1u){poolScratchStore(poolGroupAt(g,0u),staged);poolScratchStore(poolGroupAt(g,1u),bounded);}
}
/** A lane's run of groups, its counts of kind \`half\` summed. */
fn poolOffsetSum(span:vec2u,half:u32)->u32{
 var sum=0u;
 for(var g=span.x;g<span.y;g++){sum+=poolScratchLoad(poolGroupAt(g,half));}
 return sum;
}
/** A lane's run of groups, each count of kind \`half\` made its first index, from \`first\`. */
fn poolOffsetRun(span:vec2u,half:u32,first:u32){
 var cursor=first;
 for(var g=span.x;g<span.y;g++){let c=poolScratchLoad(poolGroupAt(g,half));poolScratchStore(poolGroupAt(g,half),cursor);cursor+=c;}
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn poolOffsets(@builtin(local_invocation_index) lane:u32){
 let span=laneRun(lane,ceilDiv(poolSlotCount(),POOL_LANES));
 let staged=poolOffsetSum(span,0u);
 poolOffsetRun(span,0u,laneScan(lane,staged)-staged);
 workgroupBarrier();
 let bounded=poolOffsetSum(span,1u);
 poolOffsetRun(span,1u,laneScan(lane,bounded)-bounded);
}
/** Lane \`lane\`'s run of group \`g\`'s slots, its ranks read back from \`poolChunk\`, from its first
 *  indices \`first\`: each staged slot written at its index, each of the boundary listed at the
 *  boundary's place plus its index, under the burst. */
fn poolSpreadRun(g:u32,lane:u32,bound:u32,first:vec2u){
 let span=laneRun(lane,POOL_LANES);
 var at=first;
 for(var k=span.x;k<span.y;k++){
  let rank=poolChunk[k];let part=poolSlotPart(rank,bound);let j=g*POOL_LANES+k;
  if(part==1u){poolScratchStore(2u*at.x,rank);poolScratchStore(2u*at.x+1u,j);at.x+=1u;}
  if(part==2u){
   let place=poolCountLoad(POOL_RANKS+bound)+at.y;
   if(place<poolBurst()){poolEmit(place,j);}
   at.y+=1u;
  }
 }
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn poolSpread(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let g=flatIndex(wid,n,1u);let bound=poolCountLoad(POOL_BOUND);
 let parts=poolGroupRun(g,lane,bound);
 let staged=laneScan(lane,parts.x)-parts.x;
 workgroupBarrier();
 let bounded=laneScan(lane,parts.y)-parts.y;
 if(g*POOL_LANES>=poolSlotCount()){return;}
 poolSpreadRun(g,lane,bound,vec2u(poolScratchLoad(poolGroupAt(g,0u))+staged,poolScratchLoad(poolGroupAt(g,1u))+bounded));
}
/** The slots staged: every one ranked under the burst, else those above the boundary. */
fn poolStagedCount()->u32{
 let bound=poolCountLoad(POOL_BOUND);
 if(bound<POOL_RANKS){return poolCountLoad(POOL_RANKS+bound);}
 return poolCountLoad(POOL_TOTAL);
}
/** Staged slot \`i\`'s rank and slot, \`POOL_RANKS\` past the \`staged\`. */
fn poolStagedAt(i:u32,staged:u32)->vec2u{
 if(i>=staged){return vec2u(POOL_RANKS,0u);}
 return vec2u(poolScratchLoad(2u*i),poolScratchLoad(2u*i+1u));
}
/** How many lanes of the chunk below \`lane\`, and above it, stage a slot of \`rank\`. */
fn poolChunkPeers(lane:u32,rank:u32)->vec2u{
 var peers=vec2u(0u,0u);
 for(var l=0u;l<POOL_LANES;l++){
  if(poolChunk[l]==rank){peers+=vec2u(select(0u,1u,l<lane),select(0u,1u,l>lane));}
 }
 return peers;
}
/** A staged slot listed at \`at\`, its rank's next place; the last of its rank in the chunk moves
 *  the rank's place past them. */
fn poolChunkTake(entry:vec2u,at:u32,peers:vec2u){
 if(entry.x>=POOL_RANKS){return;}
 poolEmit(at,entry.y);
 if(peers.y==0u){poolCountStore(POOL_RANKS+entry.x,at+1u);}
}
@compute @workgroup_size(POOL_LANES)
fn poolScatter(@builtin(local_invocation_index) lane:u32){
 if(lane==0u){poolStaged=poolStagedCount();}
 let staged=workgroupUniformLoad(&poolStaged);
 for(var first=0u;first<staged;first+=POOL_LANES){
  let entry=poolStagedAt(first+lane,staged);
  poolChunk[lane]=entry.x;
  workgroupBarrier();
  let peers=poolChunkPeers(lane,entry.x);
  let at=poolCountLoad(POOL_RANKS+min(entry.x,POOL_RANKS-1u))+peers.x;
  workgroupBarrier();
  poolChunkTake(entry,at,peers);
  storageBarrier();
 }
}
`,
)
