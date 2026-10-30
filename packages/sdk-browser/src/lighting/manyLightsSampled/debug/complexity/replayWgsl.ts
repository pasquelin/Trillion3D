/**
 * THE REPLAY OF THE SAMPLING'S WEIGHING FOR ONE PIXEL (`sampledLightsVisualizeLightComplexity`, `complexityReplayMain`): the kernel that finds, for the pixel under the debug cursor, what the sampling
 * (`../../samplingWgsl.ts`) saw of its lights. It is the sampling's own text up to the draw — the pixel's lit statements, its cell of the light grid, its place in the image before and the guide's
 * visible set, the surface the lights are weighed on —, then, for each light the draw would take (the cell's local lights that are drawn, the suns where they join), the sampling's own `weighLight` (the
 * luminance of the light on the pixel and the weight the draw gives it) and `lightSeenBefore` (the guide's answer), written as an entry (`entries.ts`). The lights are then sorted by weight, the
 * heaviest first, by a bitonic sort in the group's memory, and copied in that order into the result the host reads. The first thread alone walks the lights; the others sort.
 */
import { type WgslDecl, wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { TILE_CLASS } from '../../../deferred/tileClass.ts'
import { litPixelStatements } from '../../../deferred/litSurfaceWgsl.ts'
import type { ContractKey } from '../../../deferred/contractCuts.ts'
import { SAMPLED_BINDINGS } from '../../bindings.ts'
import { SAMPLED_PARAMS_WGSL } from '../../paramsWgsl.ts'
import {
  SAMPLING_PART_2,
  sampledClassOf,
  samplingParts,
  shadingStatements,
} from '../../samplingWgsl.ts'
import {
  COMPLEXITY_ENTRY_WORDS,
  COMPLEXITY_HEADER,
  COMPLEXITY_HEADER_WORDS,
  COMPLEXITY_KIND,
  COMPLEXITY_MAX_LIGHTS,
} from './entries.ts'

const B = SAMPLED_BINDINGS
export const REPLAY_ENTRY = 'complexityReplayMain'
/** The threads of the sort's group: half the lights it sorts. */
const REPLAY_THREADS = COMPLEXITY_MAX_LIGHTS / 2
/** The levels of the bitonic sort of `COMPLEXITY_MAX_LIGHTS` keys. */
const SORT_LEVELS = Math.log2(COMPLEXITY_MAX_LIGHTS)

/** What the replay reads of the request (the pixel asked, in the image's pixels) and writes: the entries it lists and the sorted result. */
const REPLAY_RESOURCES_WGSL = wgslBlock(
  'COMPLEXITY_REPLAY_RESOURCES_WGSL',
  [SAMPLED_PARAMS_WGSL],
  `@group(0) @binding(${B.complexityRequest}) var<uniform> request:vec4u;
@group(0) @binding(${B.complexityEntries}) var<storage,read_write> entries:array<u32>;
@group(0) @binding(${B.complexity}) var<storage,read_write> result:array<u32>;`,
)

/** The listing of a light: its entry, in the order the cell's lights come. */
const LIST_WGSL = wgslBlock(
  'COMPLEXITY_LIST_WGSL',
  [REPLAY_RESOURCES_WGSL],
  `var<private> foundCount:u32=0u;
var<private> foundSum:f32=0.0;
var<private> foundPoint:vec3f=vec3f(0.0);
var<private> foundValid:u32=0u;
fn kindOfLight(light:DirectLight)->u32{
 if(isSun(light)){return ${COMPLEXITY_KIND.directional}u;}
 if(isSpot(light)){return ${COMPLEXITY_KIND.spot}u;}
 if(isRect(light)){return ${COMPLEXITY_KIND.rect}u;}
 return ${COMPLEXITY_KIND.point}u;
}
/** Adds light 'rank', weighed 'weight' and seen or not in the image before, to the entries (a sun by its direction toward it); the weight of a light past the most listed still counts in the sum. */
fn listLight(rank:u32,weight:f32,seen:bool){
 foundSum+=weight;
 if(foundCount>=${COMPLEXITY_MAX_LIGHTS}u){return;}
 let light=directLights.items[rank];
 let kind=kindOfLight(light);
 let at=foundCount*${COMPLEXITY_ENTRY_WORDS}u;
 let place=select(light.positionRange.xyz,-light.directionCone.xyz,kind==${COMPLEXITY_KIND.directional}u);
 let colour=light.colorIntensity.rgb;
 entries[at]=rank|(select(0u,255u,seen)<<16u)|(kind<<24u);
 entries[at+1u]=bitcast<u32>(weight);
 entries[at+2u]=bitcast<u32>(place.x);entries[at+3u]=bitcast<u32>(place.y);entries[at+4u]=bitcast<u32>(place.z);
 entries[at+5u]=bitcast<u32>(colour.x);entries[at+6u]=bitcast<u32>(colour.y);entries[at+7u]=bitcast<u32>(colour.z);
 foundCount++;
}`,
)

/** The sort of the entries by weight, then rank: the reference's bitonic network over `COMPLEXITY_MAX_LIGHTS` keys held in the group's memory. */
const SORT_WGSL = wgslBlock(
  'COMPLEXITY_SORT_WGSL',
  [REPLAY_RESOURCES_WGSL],
  `var<workgroup> sortKeys:array<u32,${COMPLEXITY_MAX_LIGHTS}>;
var<workgroup> sortRanks:array<u32,${COMPLEXITY_MAX_LIGHTS}>;
var<workgroup> sortSlots:array<u32,${COMPLEXITY_MAX_LIGHTS}>;
var<workgroup> listed:u32;
/** Sorts the 'count' entries heaviest first (equal weights by rank) and writes them after the header; every thread of the group calls it. */
fn sortEntries(lane:u32,count:u32){
 for(var i=lane;i<${COMPLEXITY_MAX_LIGHTS}u;i+=${REPLAY_THREADS}u){
  let listedHere=i<count;
  sortKeys[i]=select(0u,entries[i*${COMPLEXITY_ENTRY_WORDS}u+1u],listedHere);
  sortRanks[i]=select(0xFFFFFFFFu,entries[i*${COMPLEXITY_ENTRY_WORDS}u]&0xFFFFu,listedHere);
  sortSlots[i]=select(0xFFFFFFFFu,i,listedHere);
 }
 workgroupBarrier();
 for(var level=0u;level<${SORT_LEVELS}u;level++){
  for(var step=0u;step<=level;step++){
   let distance=1u<<(level-step);
   let mine=lane/distance*(distance*2u)+lane%distance;
   let other=mine+distance;
   let ascending=(mine&(1u<<(level+1u)))!=0u;
   let myKey=sortKeys[mine];let myRank=sortRanks[mine];let mySlot=sortSlots[mine];
   let otherKey=sortKeys[other];let otherRank=sortRanks[other];let otherSlot=sortSlots[other];
   var swap=false;
   if(ascending){swap=myKey>otherKey||(myKey==otherKey&&myRank<otherRank);}
   else{swap=myKey<otherKey||(myKey==otherKey&&myRank>otherRank);}
   if(swap){
    sortKeys[mine]=otherKey;sortRanks[mine]=otherRank;sortSlots[mine]=otherSlot;
    sortKeys[other]=myKey;sortRanks[other]=myRank;sortSlots[other]=mySlot;
   }
   workgroupBarrier();
  }
 }
 for(var k=lane;k<count;k+=${REPLAY_THREADS}u){
  let source=sortSlots[k]*${COMPLEXITY_ENTRY_WORDS}u;
  let outAt=${COMPLEXITY_HEADER_WORDS}u+k*${COMPLEXITY_ENTRY_WORDS}u;
  for(var word=0u;word<${COMPLEXITY_ENTRY_WORDS}u;word++){result[outAt+word]=entries[source+word];}
 }
}`,
)

/**
 * The replay's text for a program cut by `key`: the sampling's pieces (`samplingParts`, with the replay's resources in place of the sampling's) and the entry. The pixel is of the most demanding
 * class (a complex one, the rectangle lights in), which weighs a light as every class does for a pixel of a simpler one. A pixel no light is drawn over lists nothing, the header saying so.
 */
export function replayWgsl(key: ContractKey, front: boolean, textured: boolean): WgslDecl {
  const { lights, cut } = sampledClassOf(key, TILE_CLASS.complex, true)
  const statements = litPixelStatements(cut, 'return;')
  return wgslBlock(
    `complexityReplayWgsl(${key.lobeless}, ${key.profileless}, ${key.channelless}, ${key.narrow}${front ? ', front layer' : ''}${textured ? '' : ', plain rectangles'})`,
    [...samplingParts(key, lights, cut, textured, REPLAY_RESOURCES_WGSL), LIST_WGSL, SORT_WGSL],
    `/** Lists the lights of the pixel asked. */
fn replay(){
 let screen=request.xy;
 if(any(screen>=vec2u(view.viewport.xy))){return;}
 let down=screen/params.factor;
 let pixel=vec4f(vec2f(screen)+vec2f(0.5),0.0,1.0);${statements}
${SAMPLING_PART_2}${shadingStatements(front)}
 foundPoint=P;
 foundValid=1u;
 for(var index=0u;index<cell.y;index++){
  let rank=listedLight(cell,index);
  if(!listedDrawn(cell,rank)||!sampledTakes(rank)){continue;}
  if(isSun(directLights.items[rank])){continue;}
  let weighed=weighLight(rank,albedo,base.a,normal.a,N,V,P,shading,true);
  listLight(rank,weighed.weight,lightSeenBefore(rank,weighed.luminance,visibleSet));
 }
 if(params.directional!=0u){
  for(var index=1u;index<=sunRanks[0];index++){
   let rank=sunRanks[index];
   let weighed=weighLight(rank,albedo,base.a,normal.a,N,V,P,shading,false);
   listLight(rank,weighed.weight,lightSeenBefore(rank,weighed.luminance,visibleSet));
  }
 }
}
@compute @workgroup_size(${REPLAY_THREADS},1,1)
fn ${REPLAY_ENTRY}(@builtin(local_invocation_index) lane:u32){
 if(lane==0u){
  replay();
  listed=foundCount;
  result[${COMPLEXITY_HEADER.count}]=foundCount;
  result[${COMPLEXITY_HEADER.sum}]=bitcast<u32>(foundSum);
  result[${COMPLEXITY_HEADER.position}]=bitcast<u32>(foundPoint.x);
  result[${COMPLEXITY_HEADER.position + 1}]=bitcast<u32>(foundPoint.y);
  result[${COMPLEXITY_HEADER.position + 2}]=bitcast<u32>(foundPoint.z);
  result[${COMPLEXITY_HEADER.valid}]=foundValid;
  result[${COMPLEXITY_HEADER.written}]=1u;
 }
 storageBarrier();
 workgroupBarrier();
 sortEntries(lane,listed);
}`,
  )
}
