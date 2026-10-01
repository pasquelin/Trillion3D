import { RANK_SPAN } from '../../../../sdk-core/src/scene/light-shadow/rankSpan.ts';

/**
 * THE GPU PAGES A FRAME DRAWS ITSELF, PICKED (#831): of the pages the allocation and the host's
 * words listed (`freshWgsl.ts`), those still waiting, up to the frame's static fill
 * (`params.budget`), the coarsest first. Lane 0 of the compose runs it; its workgroup holds the
 * pool's layers (`layerCount`) and the regions picked (`regionCount`), declared by the compose.
 */
export const FRESH_PICK_WGSL = `
const RANK_SPAN:u32=${RANK_SPAN}u;
var<workgroup> rankCount:array<u32,${RANK_SPAN}>;
/** Whether listed page \`p\` still waits for a draw: mapped, not readable, its word its own, drawn
 *  by none. */
fn freshWaiting(p:u32)->bool{
 let e=shadowPool.pages[poolAt(POOL_OWNER,p)];
 if(e<0){return false;}
 let word=shadows.table[u32(e)];
 return (word&(PAGE_MAPPED|PAGE_VALID))==PAGE_MAPPED&&(word&PAGE_INDEX_MASK)==p&&shadowPool.pages[poolAt(POOL_DRAWNBY,p)]==DRAWN_NONE;
}
/** Page \`p\`'s coarseness, within the ranks a key spans: the order its fill is served in. */
fn freshRank(p:u32)->u32{return u32(clamp(shadowPool.pages[poolAt(POOL_RANK,p)],0,i32(RANK_SPAN)-1));}
/** Lane 0: the listed pages still waiting for a draw, up to the frame's static fill
 *  (\`params.budget\`, \`shadowPagesPerFrame\` less the host's fills, #831) — the coarsest first,
 *  a finer page falling back to them —, each claimed once, then laid out as regions layer after
 *  layer (\`FRESH_LAYER_STARTS\`, \`FRESH_REGION_PAGES\`). A page past the budget stays listed and
 *  unclaimed: it reads the coarser page and is drawn the next frames. */
fn pickPages(){
 for(var l=0u;l<params.layers;l++){layerCount[l]=0u;}
 for(var r=0u;r<RANK_SPAN;r++){rankCount[r]=0u;}
 // The waiting pages, compacted at the list's head as they are counted: the pick walks them alone.
 let listed=min(countRead(COUNT_DRAWN),params.pages);var waiting=0u;
 for(var i=0u;i<listed;i++){
  let p=drawList[i];
  if(freshWaiting(p)){rankCount[freshRank(p)]+=1u;drawList[waiting]=p;waiting++;}
 }
 // The finest rank the budget reaches (\`cut\`), and the pages of it it holds (\`room\`).
 var room=min(params.budget,MAX_REGIONS);var cut=0u;var whole=true;
 for(var r=i32(RANK_SPAN)-1;r>=0;r--){
  let n=rankCount[u32(r)];
  if(n>=room){cut=u32(r);whole=false;break;}
  room-=n;
 }
 var picked=0u;var atCut=0u;
 for(var i=0u;i<waiting;i++){
  let p=drawList[i];
  let rank=freshRank(p);
  if(!whole&&rank<cut){continue;}
  if(!whole&&rank==cut){if(atCut>=room){continue;}atCut++;}
  shadowPool.pages[poolAt(POOL_DRAWNBY,p)]=DRAWN_GPU;drawList[picked]=p;picked++;
  layerCount[poolLayer(p)]+=1u;
 }
 var start=0u;
 for(var l=0u;l<params.layers;l++){args[FRESH_LAYER_STARTS+l]=start;start+=layerCount[l];layerCount[l]=0u;}
 for(var i=0u;i<picked;i++){
  let p=drawList[i];let l=poolLayer(p);
  args[FRESH_REGION_PAGES+args[FRESH_LAYER_STARTS+l]+layerCount[l]]=p;layerCount[l]+=1u;
 }
 regionCount=picked;
}
`;
