import { ceilDivWgsl, lowBits, zOrderDecode } from '../../../../math/src/wgsl/integer.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { GROUP_GRID_WGSL } from '../../gpu/dispatch/grid.ts'
import { PAGE_INFO_STRUCT_WGSL } from './pageWgsl.ts'
import { MATERIAL_CLASS_OF_WGSL } from './materialClass.ts'
import { SHADE_UNI_WGSL } from './pixelTriangleWgsl.ts'
import { SUBGROUP_ALL_WGSL } from '../../gpu/core/subgroups.ts'
import {
  SHADE_BIN_GROUP,
  SHADE_BIN_NONE,
  SHADING_MASK_WGSL,
  shadeBinElementsWgsl,
  shadeBinMetaWgsl,
  shadeBinsWgsl,
} from './shadeBinsWgsl.ts'

/** Lanes of a full tile: the quads of a square of 8 × 8 pixels, sixteen lanes in a row along the
 *  Z-order — one shading workgroup's pixels. */
const FULL_LANES = SHADE_BIN_GROUP / 4
/** Bits of a word, the lanes a word of one bit a lane holds, and the bits a lane's loose elements
 *  take in unary: so the lanes a word of those holds. */
const WORD_BITS = 32
const LOOSE_BITS = 4
const LOOSE_PER_WORD = WORD_BITS / LOOSE_BITS
/** The workgroup's vote of the full tiles and of the loose elements, sized by its lanes. */
const KERNEL_CONSTANTS_WGSL = wgslBlock(
  'SHADE_BIN_KERNEL_CONSTANTS_WGSL',
  [],
  wgslConsts({
    FULL_LANES,
    FULL_MASK: 2 ** FULL_LANES - 1,
    WORD_BITS,
    FULL_WORDS: SHADE_BIN_GROUP / WORD_BITS,
    LOOSE_BITS,
    LOOSE_PER_WORD,
    LOOSE_WORDS: SHADE_BIN_GROUP / LOOSE_PER_WORD,
  }),
)

const BINS_AND_COUNTERS = `/** The bins of a quad's four pixels where they hold none: four, so that no two compare equal. */
const NO_BINS=vec4i(-1,-2,-3,-4);
/** Bin \`bin\`'s counter of loose elements, then of full tiles' ones (\`work\` word 0 the allocator). */
fn looseCounter(bin:u32)->u32{return 1u+2u*bin;}
fn fullCounter(bin:u32)->u32{return 2u+2u*bin;}
/** The shading mask of pixel \`at\` (\`packShadingMask\`): zero past the image. */
fn pixelMask(at:vec2u)->u32{
 if(any(at>=textureDimensions(mask))){return 0u;}
 return textureLoad(mask,vec2i(at),0).r;
}`

/** The write of lane \`lane\`'s elements into the bin's range, shared by both ways to place them. */
const WRITE_ELEMENTS = `/** Lane \`lane\`'s \`elements\` of bin \`bin\` written in its range: \`element\` the first of them,
 *  \`hit\` the pixels of its quad, of top-left corner \`quad\`, that are the bin's. */
fn writeElements(quad:vec2u,bin:u32,hit:vec4<bool>,element:u32,quads:bool){
 let range=binRange(bin);
 if(quads){
  var mask=0u;
  for(var k=0u;k<4u;k++){if(hit[k]){mask|=1u<<(4u*k);}}
  elementsWordStore(range.y+SHADE_BIN_QUAD_WORDS*element,0u,vec4u(packBinPixel(quad,0u),0u,0u,0u));
  elementsWordStore(range.y+SHADE_BIN_QUAD_WORDS*element+1u,0u,vec4u(mask,0u,0u,0u));
 }else{
  var at=range.y+element;
  for(var k=0u;k<4u;k++){
   if(hit[k]){elementsWordStore(at,0u,vec4u(packBinPixel(quad+vec2u(k&1u,k>>1u),1u),0u,0u,0u));at++;}
  }
 }
}
/** The full tiles among the lanes' bits: whether each sixteen lanes' quads are all the bin's. */
fn fullTilesOf(lanes:vec2u)->vec4<bool>{
 return vec4u(lanes.x&FULL_MASK,lanes.x>>FULL_LANES,lanes.y&FULL_MASK,lanes.y>>FULL_LANES)==vec4u(FULL_MASK);
}
/** The full tiles before tile \`tile\`, then the full tiles in all. */
fn fullTilesBefore(fullTiles:vec4<bool>,tile:u32)->u32{
 let ones=vec4u(1u);
 return dot(select(vec4u(0u),ones,fullTiles&(vec4u(0u,1u,2u,3u)<vec4u(tile))),ones);
}
fn fullTileCount(fullTiles:vec4<bool>)->u32{return dot(select(vec4u(0u),vec4u(1u),fullTiles),vec4u(1u));}`

/** The tile's lane \`lane\` read into its quad's masks, and the passes over the bins of the modes
 *  the image holds (\`ANY_PIXEL\`, \`ANY_QUAD\`). */
const BIN_TILE = `/** Tile \`tile\`'s quads, lane \`lane\`'s along the Z-order: its pixels' bins, those binned alone
 *  then those binned by quad (\`SHADE_BIN_QUAD\`) — a mode no bin of the image holds is not run. A tile
 *  with no pixel of any bin leaves before any vote. */
fn binTile(tile:vec2u,lane:u32,scatter:bool){
 let quad=tile*SHADE_BIN_TILE+zOrderDecode(lane)*2u;
 let masks=vec4u(pixelMask(quad),pixelMask(quad+vec2u(1u,0u)),pixelMask(quad+vec2u(0u,1u)),pixelMask(quad+vec2u(1u,1u)));
 let some=maskPixels(masks);
 if(!tileHasPixels(lane,any(some))){return;}
 let quads=maskQuads(masks);
 let bins=maskBinsOf(masks);
 if(ANY_PIXEL){binPass(quad,lane,select(NO_BINS,bins,some&!quads),false,scatter);}
 if(ANY_QUAD){binPass(quad,lane,select(NO_BINS,bins,some&quads),true,scatter);}
}`

const RESERVE = `@compute @workgroup_size(SHADE_BIN_GROUP) fn clearBins(@builtin(global_invocation_id) id:vec3u){
 if(id.x==0u){atomicStore(&work[0],0u);}
 if(id.x<binCount){atomicStore(&work[looseCounter(id.x)],0u);atomicStore(&work[fullCounter(id.x)],0u);}
}
@compute @workgroup_size(SHADE_BIN_GROUP) fn reserveBins(@builtin(global_invocation_id) id:vec3u){
 let bin=id.x;
 if(bin>=binCount){return;}
 let info=binMeta[bin];
 let quads=(info.z&SHADE_BIN_META_QUADS)!=0u;
 let count=atomicLoad(&work[looseCounter(bin)]);
 var start=0u;
 if(count>0u){
  start=atomicAdd(&work[0],select(count,SHADE_BIN_QUAD_WORDS*count,quads));
  atomicStore(&work[looseCounter(bin)],0u);
  atomicStore(&work[fullCounter(bin)],0u);
 }
 binMeta[bin]=vec4u(count,start,info.z,0u);
 let grid=groupGrid(ceilDiv(select(count,SHADE_BIN_QUAD_LANES*count,quads),SHADE_BIN_GROUP));
 args[bin*SHADE_BIN_ARGS]=grid.x;args[bin*SHADE_BIN_ARGS+1u]=grid.y;args[bin*SHADE_BIN_ARGS+2u]=1u;
}`

/** Binding numbers of `maskBins`, past the walks' (`MASK_BINDINGS`): the identifiers, the page
 *  table, the resolve's uniform, the bins' head, the masks written. */
export const MASK_BINDINGS = { ids: 6, pages: 7, uniform: 8, head: 9, mask: 10 }

/** The masks of an image whose identifiers are `ids` (a capture's: no export wrote its masks), one
 *  thread a texel as the export would write them (`packShadingMask`). */
const MASK_FROM_IDS = `@group(0) @binding(${MASK_BINDINGS.ids}) var ids:texture_2d<u32>;
@group(0) @binding(${MASK_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${MASK_BINDINGS.uniform}) var<uniform> uni:ShadeUni;
@group(0) @binding(${MASK_BINDINGS.mask}) var maskOut:texture_storage_2d<r32uint,write>;
@compute @workgroup_size(8,8) fn maskBins(@builtin(global_invocation_id) g:vec3u){
 if(any(g.xy>=textureDimensions(maskOut))){return;}
 var word=SHADE_BIN_NONE;
 if(all(vec2f(g.xy)<uni.viewport)){
  let key=materialClassOf(textureLoad(ids,vec2i(g.xy),0).r);
  if(key!=0u){word=binOfClass(key-1u);}
 }
 textureStore(maskOut,g.xy,vec4u(packShadingMask(word),0u,0u,0u));
}`

/** The kernels' bindings, then the modes the image holds: the shading masks, the image's bin count,
 *  the bins' meta — read and written — and elements — written —, the counters and the dispatches. */
const HEAD = `@group(0) @binding(0) var mask:texture_2d<u32>;
@group(0) @binding(1) var<uniform> binCount:u32;
@group(0) @binding(4) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> args:array<u32>;
/** Whether some bin of the image holds pixels, whether some holds quads: from \`assign\`
 *  (\`../../materials/classes/shadeBins.ts\`), a mode no bin holds has no pass. */
override ANY_PIXEL:bool=true;
override ANY_QUAD:bool=true;
${BINS_AND_COUNTERS}`

/**
 * The workgroup's way: the lanes vote through workgroup memory, every step a barrier. The bins of
 * one mode lane `lane`'s quad holds (`start`, `NO_BINS` where a pixel holds none of the mode), taken
 * one at a time, the greatest first: the lanes vote it, then count or scatter their elements of it.
 * A lane past its last bin still meets every barrier: the loop is the workgroup's, its end read
 * uniform (`workgroupUniformLoad`).
 */
const WORKGROUP_WAY = `var<workgroup> votedBin:atomic<i32>;
var<workgroup> voted:i32;
var<workgroup> tileCount:atomic<u32>;
var<workgroup> tileValid:atomic<u32>;
var<workgroup> tileFlag:u32;
/** A bit a lane whose quad is all the voted bin's. */
var<workgroup> fullLanes:array<atomic<u32>,FULL_WORDS>;
/** Each lane's loose elements of the voted bin, in unary, four bits a lane. */
var<workgroup> looseLanes:array<atomic<u32>,LOOSE_WORDS>;
/** The tile's first element of the voted bin's full tiles, then of its loose ones. */
var<workgroup> bases:vec2u;
/** Whether any lane of the workgroup holds a pixel (\`valid\` lane \`lane\`'s own). */
fn tileHasPixels(lane:u32,valid:bool)->bool{
 if(valid){atomicStore(&tileValid,1u);}
 workgroupBarrier();
 if(lane==0u){tileFlag=atomicLoad(&tileValid);}
 return workgroupUniformLoad(&tileFlag)!=0u;
}
/** The count of the voted bin \`bin\`: every lane's \`elements\` of it in one add of the tile, as
 *  loose — where they land is the scatter's. */
fn countElements(lane:u32,bin:u32,elements:u32){
 atomicAdd(&tileCount,elements);
 workgroupBarrier();
 if(lane==0u){let n=atomicLoad(&tileCount);if(n>0u){atomicAdd(&work[looseCounter(bin)],n);}}
}
/** The scatter of the voted bin \`bin\`: lane \`lane\`'s \`elements\` of it, written in the bin's range,
 *  a full tile's from its start, a loose lane's from its end (above). */
fn scatterElements(quad:vec2u,lane:u32,bin:u32,hit:vec4<bool>,elements:u32,quads:bool){
 if(all(hit)){atomicOr(&fullLanes[lane/WORD_BITS],1u<<(lane%WORD_BITS));}
 workgroupBarrier();
 let fullTiles=fullTilesOf(vec2u(atomicLoad(&fullLanes[0]),atomicLoad(&fullLanes[1])));
 let tile=lane/FULL_LANES;
 let full=fullTiles[tile];
 atomicOr(&looseLanes[lane/LOOSE_PER_WORD],lowBits(select(elements,0u,full))<<(LOOSE_BITS*(lane%LOOSE_PER_WORD)));
 workgroupBarrier();
 var looseBefore=countOneBits(atomicLoad(&looseLanes[lane/LOOSE_PER_WORD])&lowBits(LOOSE_BITS*(lane%LOOSE_PER_WORD)));
 var looseCount=0u;
 for(var w=0u;w<LOOSE_WORDS;w++){
  let n=countOneBits(atomicLoad(&looseLanes[w]));
  looseCount+=n;
  if(w<lane/LOOSE_PER_WORD){looseBefore+=n;}
 }
 let perLane=select(SHADE_BIN_QUAD_LANES,1u,quads);
 let perTile=FULL_LANES*perLane;
 if(lane==0u){
  var first=vec2u(0u);
  let fullCount=fullTileCount(fullTiles)*perTile;
  if(fullCount>0u){first.x=atomicAdd(&work[fullCounter(bin)],fullCount);}
  if(looseCount>0u){first.y=atomicAdd(&work[looseCounter(bin)],looseCount);}
  bases=first;
 }
 let base=workgroupUniformLoad(&bases);
 if(elements>0u){
  var element=base.x+fullTilesBefore(fullTiles,tile)*perTile+(lane%FULL_LANES)*perLane;
  if(!full){element=binRange(bin).x-(base.y+looseBefore)-elements;}
  writeElements(quad,bin,hit,element,quads);
 }
}
fn binPass(quad:vec2u,lane:u32,start:vec4i,quads:bool,scatter:bool){
 var held=start;
 loop{
  let greatest=max(max(held.x,held.y),max(held.z,held.w));
  workgroupBarrier();
  if(lane==0u){
   atomicStore(&votedBin,-1);atomicStore(&tileCount,0u);
   atomicStore(&fullLanes[0],0u);atomicStore(&fullLanes[1],0u);
   for(var w=0u;w<LOOSE_WORDS;w++){atomicStore(&looseLanes[w],0u);}
  }
  workgroupBarrier();
  if(greatest>=0){atomicMax(&votedBin,greatest);}
  workgroupBarrier();
  if(lane==0u){voted=atomicLoad(&votedBin);}
  let bin=workgroupUniformLoad(&voted);
  if(bin<0){break;}
  let hit=held==vec4i(bin);
  let pixels=dot(select(vec4u(0u),vec4u(1u),hit),vec4u(1u));
  let elements=select(pixels,min(pixels,1u),quads);
  if(scatter){scatterElements(quad,lane,u32(bin),hit,elements,quads);}
  else{countElements(lane,u32(bin),elements);}
  held=select(held,NO_BINS,hit);
 }
}`

/**
 * The subgroup's way, on a device whose subgroups are the workgroup's sixty-four lanes (a lane the
 * subgroup's invocation, the quads along the Z-order by it): no barrier. The bin of a round is the
 * subgroup's greatest (`subgroupMax`), a negative one the end of every lane's loop at once; a
 * count is one `subgroupAdd` and one counter add; a scatter's places are a ballot of the full
 * tiles and an exclusive sum of the loose elements, the tile's two counter adds taken by lane 0.
 */
const SUBGROUP_WAY = `/** Whether any lane of the subgroup holds a pixel (\`valid\` its own). */
fn tileHasPixels(lane:u32,valid:bool)->bool{return subgroupAny(valid);}
fn countElements(lane:u32,bin:u32,elements:u32){
 let n=subgroupAdd(elements);
 if(lane%SUBGROUP_LANES==0u&&n>0u){atomicAdd(&work[looseCounter(bin)],n);}
}
fn scatterElements(quad:vec2u,lane:u32,bin:u32,hit:vec4<bool>,elements:u32,quads:bool){
 let fullTiles=fullTilesOf(subgroupBallot(all(hit)).xy);
 let tile=(lane%SUBGROUP_LANES)/FULL_LANES;
 let full=fullTiles[tile];
 let loose=select(elements,0u,full);
 let looseBefore=subgroupExclusiveAdd(loose);
 let looseCount=subgroupAdd(loose);
 let perLane=select(SHADE_BIN_QUAD_LANES,1u,quads);
 let perTile=FULL_LANES*perLane;
 var first=vec2u(0u);
 if(lane%SUBGROUP_LANES==0u){
  let fullCount=fullTileCount(fullTiles)*perTile;
  if(fullCount>0u){first.x=atomicAdd(&work[fullCounter(bin)],fullCount);}
  if(looseCount>0u){first.y=atomicAdd(&work[looseCounter(bin)],looseCount);}
 }
 let base=subgroupBroadcastFirst(first);
 if(elements>0u){
  var element=base.x+fullTilesBefore(fullTiles,tile)*perTile+(lane%FULL_LANES)*perLane;
  if(!full){element=binRange(bin).x-(base.y+looseBefore)-elements;}
  writeElements(quad,bin,hit,element,quads);
 }
}
fn binPass(quad:vec2u,lane:u32,start:vec4i,quads:bool,scatter:bool){
 var held=start;
 loop{
  let bin=subgroupMax(max(max(held.x,held.y),max(held.z,held.w)));
  if(bin<0){break;}
  let hit=held==vec4i(bin);
  let pixels=dot(select(vec4u(0u),vec4u(1u),hit),vec4u(1u));
  let elements=select(pixels,min(pixels,1u),quads);
  if(scatter){scatterElements(quad,lane,u32(bin),hit,elements,quads);}
  else{countElements(lane,u32(bin),elements);}
  held=select(held,NO_BINS,hit);
 }
}`

const WORKGROUP_ENTRIES = `@compute @workgroup_size(SHADE_BIN_GROUP) fn countBins(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) lane:u32){binTile(tile.xy,lane,false);}
@compute @workgroup_size(SHADE_BIN_GROUP) fn scatterBins(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) lane:u32){binTile(tile.xy,lane,true);}`
const SUBGROUP_ENTRIES = `fn subgroupLane(index:u32,invocation:u32)->u32{return (index&~(SUBGROUP_LANES-1u))|invocation;}
@compute @workgroup_size(SHADE_BIN_GROUP) fn countBins(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) index:u32,@builtin(subgroup_invocation_id) invocation:u32){binTile(tile.xy,subgroupLane(index,invocation),false);}
@compute @workgroup_size(SHADE_BIN_GROUP) fn scatterBins(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) index:u32,@builtin(subgroup_invocation_id) invocation:u32){binTile(tile.xy,subgroupLane(index,invocation),true);}`

/**
 * THE SHADING BINS' KERNELS (`shadeBinsWgsl.ts`), four dispatches of the material pass, in this
 * order (`../../materials/classes/shadeBins.ts`):
 * - `clearBins` zeroes the allocator and each bin's two counters, of its full tiles' elements and of
 *   its loose ones;
 * - `countBins` counts each bin's elements: a workgroup a tile of `SHADE_BIN_TILE` pixels a side, a
 *   lane a quad of it, the lanes along the Z-order (`zOrderDecode`) — four lanes in a row a square of
 *   4 × 4 pixels, sixteen one of 8 × 8. A lane reads its quad's four shading masks (the export wrote
 *   them: `packShadingMask`) and nothing else; a tile with no pixel of any bin leaves at once. The
 *   pixels of each mode the image holds go through their own loop (`binPass`), pixels then quads:
 *   the tile's bins taken one at a time, the greatest first — the lanes vote it, those holding it
 *   count its elements, their pixels of it or their one quad —, one counter add a tile and a bin;
 * - `reserveBins`, a lane a bin, takes the bin's range of the elements from the allocator — a word
 *   an element, two a quad —, writes its meta (element count, first word) and sets its counters
 *   back to zero and writes its dispatch: a lane an element, four a quad, `SHADE_BIN_GROUP` lanes a
 *   workgroup, in rows (`groupGrid`);
 * - `scatterBins` walks the tiles again as the count did and writes each element in its bin's range.
 *   The sixteen lanes of a square of 8 × 8 pixels all of the voted bin's make a full tile: its
 *   elements go from the range's start, sixty-four pixels or sixteen quads, the whole of a shading
 *   workgroup; every other lane's are loose and go from the range's end. Either kind takes its
 *   place in lane order — after the elements of the lanes before it —, a tile's run after the place
 *   its counter add gave it.
 * With `subgroupLanes` the votes and places are the subgroup's (`SUBGROUP_WAY`), without it the
 * workgroup's (`WORKGROUP_WAY`).
 */
/** The subgroup sizes the kernels run on, each with its own variant: the workgroup's lanes, or a half. */
export const SHADE_BIN_SUBGROUP_LANES = [SHADE_BIN_GROUP, SHADE_BIN_GROUP / 2] as const
/** The lanes of the subgroup the kernels vote on, as a constant. */
const subgroupLanesWgsl = (lanes: number) =>
  wgslBlock('SUBGROUP_LANES_WGSL', [], wgslConsts({ SUBGROUP_LANES: lanes }))

const shadeBinsShader = (subgroupLanes: number) => {
  const subgroups = subgroupLanes > 0
  return wgslProgram(
    [
      HEAD,
      WRITE_ELEMENTS,
      subgroups ? SUBGROUP_WAY : WORKGROUP_WAY,
      BIN_TILE,
      RESERVE,
      subgroups ? SUBGROUP_ENTRIES : WORKGROUP_ENTRIES,
      MASK_FROM_IDS,
    ].join('\n'),
    [
      shadeBinMetaWgsl({ group: 0, binding: 2, access: 'read_write' }),
      shadeBinElementsWgsl({ group: 0, binding: 3, access: 'write' }),
      shadeBinsWgsl({ group: 0, binding: MASK_BINDINGS.head, access: 'read' }),
      PAGE_INFO_STRUCT_WGSL,
      SHADE_UNI_WGSL,
      MATERIAL_CLASS_OF_WGSL,
      SHADING_MASK_WGSL,
      KERNEL_CONSTANTS_WGSL,
      GROUP_GRID_WGSL,
      ceilDivWgsl,
      zOrderDecode,
      ...(subgroups ? [SUBGROUP_ALL_WGSL, subgroupLanesWgsl(subgroupLanes)] : [lowBits]),
    ],
  )
}

/** The kernels on the workgroup's barriers, and on the subgroup, by its lanes. */
export const SHADE_BINS_SHADER = shadeBinsShader(0)
export const SHADE_BINS_SUBGROUP_SHADERS = Object.fromEntries(
  SHADE_BIN_SUBGROUP_LANES.map((lanes) => [lanes, shadeBinsShader(lanes)]),
) as Record<(typeof SHADE_BIN_SUBGROUP_LANES)[number], string>
