import { ceilDivWgsl, lowBits, zOrderDecode } from '../../../../math/src/wgsl/integer.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PAGE_INFO_STRUCT_WGSL } from './pageWgsl.ts'
import { MATERIAL_CLASS_OF_WGSL } from './materialClass.ts'
import { SHADE_UNI_WGSL } from './pixelTriangleWgsl.ts'
import { GROUP_GRID_WGSL } from '../../gpu/dispatch/grid.ts'
import { SHADE_BIN_GROUP, shadeBinElementsWgsl, shadeBinsWgsl } from './shadeBinsWgsl.ts'

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

/**
 * THE SHADING BINS' KERNELS (`shadeBinsWgsl.ts`), four dispatches of the material pass, in this
 * order (`../../materials/classes/shadeBins.ts`):
 * - `clearBins` zeroes the allocator and each bin's two counters, of its full tiles' elements and of
 *   its loose ones;
 * - `countBins` counts each bin's elements: a workgroup a tile of `SHADE_BIN_TILE` pixels a side, a
 *   lane a quad of it, the lanes along the Z-order (`zOrderDecode`) — four lanes in a row a square of
 *   4 × 4 pixels, sixteen one of 8 × 8. The pixels of each mode go through their own loop
 *   (`binPass`), pixels then quads: the tile's bins taken one at a time, the greatest first — the
 *   lanes vote it, those holding it count its elements, their pixels of it or their one quad —, one
 *   counter add a tile and a bin;
 * - `reserveBins`, a lane a bin, takes the bin's range of the elements from the allocator — a word
 *   an element, two a quad —, writes its element count and its first word, sets its counters back to
 *   zero and writes its dispatch: a lane an element, four a quad, `SHADE_BIN_GROUP` lanes a
 *   workgroup, in rows (`groupGrid`);
 * - `scatterBins` walks the tiles again as the count did and writes each element in its bin's range.
 *   The sixteen lanes of a square of 8 × 8 pixels all of the voted bin's make a full tile: its
 *   elements go from the range's start, sixty-four pixels or sixteen quads, the whole of a shading
 *   workgroup; every other lane's are loose and go from the range's end. Either kind takes its
 *   place in lane order — after the elements of the lanes before it, which each wrote in unary
 *   (`countOneBits`) —, a tile's run after the place its counter add gave it.
 * A pixel's bin is its class's (`materialClassOf`), as the head names it (`binOfClass`); the
 * background, a pixel past the image and a class without a bin this image take none.
 */
export const SHADE_BINS_SHADER = wgslProgram(
  `@group(0) @binding(0) var vis:texture_2d<u32>;
@group(0) @binding(1) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(2) var<uniform> uni:ShadeUni;
@group(0) @binding(3) var<uniform> binCount:u32;
@group(0) @binding(6) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(7) var<storage,read_write> args:array<u32>;
var<workgroup> votedBin:atomic<i32>;
var<workgroup> voted:i32;
var<workgroup> tileCount:atomic<u32>;
/** A bit a lane whose quad is all the voted bin's. */
var<workgroup> fullLanes:array<atomic<u32>,FULL_WORDS>;
/** Each lane's loose elements of the voted bin, in unary, four bits a lane. */
var<workgroup> looseLanes:array<atomic<u32>,LOOSE_WORDS>;
/** The tile's first element of the voted bin's full tiles, then of its loose ones. */
var<workgroup> bases:vec2u;
/** The bins of a quad's four pixels where they hold none: four, so that no two compare equal. */
const NO_BINS=vec4i(-1,-2,-3,-4);
/** Bin \`bin\`'s counter of loose elements, then of full tiles' ones (\`work\` word 0 the allocator). */
fn looseCounter(bin:u32)->u32{return 1u+2u*bin;}
fn fullCounter(bin:u32)->u32{return 2u+2u*bin;}
/** The class word of pixel \`at\` of an image of \`size\` (\`binOfClass\`): \`SHADE_BIN_NONE\` past
 *  the image, on the background, for a class without a bin. */
fn pixelWord(at:vec2u,size:vec2u)->u32{
 if(any(at>=size)){return SHADE_BIN_NONE;}
 let key=materialClassOf(textureLoad(vis,vec2i(at),0).r);
 if(key==0u){return SHADE_BIN_NONE;}
 let word=binOfClass(key-1u);
 if((word&~SHADE_BIN_QUAD)>=binCount){return SHADE_BIN_NONE;}
 return word;
}
@compute @workgroup_size(SHADE_BIN_GROUP) fn clearBins(@builtin(global_invocation_id) id:vec3u){
 if(id.x==0u){atomicStore(&work[0],0u);}
 if(id.x<binCount){atomicStore(&work[looseCounter(id.x)],0u);atomicStore(&work[fullCounter(id.x)],0u);}
}
/** The count of the voted bin \`bin\`: every lane's \`elements\` of it in one add of the tile, as
 *  loose — where they land is the scatter's. */
fn countElements(lane:u32,bin:u32,elements:u32){
 atomicAdd(&tileCount,elements);
 workgroupBarrier();
 if(lane==0u){let n=atomicLoad(&tileCount);if(n>0u){atomicAdd(&work[looseCounter(bin)],n);}}
}
/** The scatter of the voted bin \`bin\`: lane \`lane\`'s \`elements\` of it — \`hit\` the pixels of
 *  its quad, of top-left corner \`quad\`, that are the bin's; \`quads\` the bin's mode — written in
 *  the bin's range, a full tile's from its start, a loose lane's from its end (above). */
fn scatterElements(quad:vec2u,lane:u32,bin:u32,hit:vec4<bool>,elements:u32,quads:bool){
 if(all(hit)){atomicOr(&fullLanes[lane/WORD_BITS],1u<<(lane%WORD_BITS));}
 workgroupBarrier();
 let lanes=vec2u(atomicLoad(&fullLanes[0]),atomicLoad(&fullLanes[1]));
 let fullTiles=vec4u(lanes.x&FULL_MASK,lanes.x>>FULL_LANES,lanes.y&FULL_MASK,lanes.y>>FULL_LANES)==vec4u(FULL_MASK);
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
 let ones=vec4u(1u);
 let fullBefore=dot(select(vec4u(0u),ones,fullTiles&(vec4u(0u,1u,2u,3u)<vec4u(tile))),ones);
 let perLane=select(SHADE_BIN_QUAD_LANES,1u,quads);
 let perTile=FULL_LANES*perLane;
 if(lane==0u){
  var first=vec2u(0u);
  let fullCount=dot(select(vec4u(0u),ones,fullTiles),ones)*perTile;
  if(fullCount>0u){first.x=atomicAdd(&work[fullCounter(bin)],fullCount);}
  if(looseCount>0u){first.y=atomicAdd(&work[looseCounter(bin)],looseCount);}
  bases=first;
 }
 let base=workgroupUniformLoad(&bases);
 if(elements>0u){
  let range=binRange(bin);
  var element=base.x+fullBefore*perTile+(lane%FULL_LANES)*perLane;
  if(!full){element=range.x-(base.y+looseBefore)-elements;}
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
}
/** The bins of one mode lane \`lane\`'s quad holds (\`start\`, \`NO_BINS\` where a pixel holds none
 *  of the mode), taken one at a time, the greatest first: the lanes vote it, then count or
 *  scatter their elements of it. A lane past its last bin still meets every barrier: the loop is
 *  the workgroup's, its end read uniform (\`workgroupUniformLoad\`). */
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
}
/** Tile \`tile\`'s quads, lane \`lane\`'s along the Z-order: its pixels' bins, those binned alone
 *  then those binned by quad (\`SHADE_BIN_QUAD\`). */
fn binTile(tile:vec2u,lane:u32,scatter:bool){
 let size=vec2u(uni.viewport);
 let quad=tile*SHADE_BIN_TILE+zOrderDecode(lane)*2u;
 let words=vec4u(pixelWord(quad,size),pixelWord(quad+vec2u(1u,0u),size),pixelWord(quad+vec2u(0u,1u),size),pixelWord(quad+vec2u(1u,1u),size));
 let some=words!=vec4u(SHADE_BIN_NONE);
 let quads=(words&vec4u(SHADE_BIN_QUAD))!=vec4u(0u);
 let bins=vec4i(words&vec4u(~SHADE_BIN_QUAD));
 binPass(quad,lane,select(NO_BINS,bins,some&!quads),false,scatter);
 binPass(quad,lane,select(NO_BINS,bins,some&quads),true,scatter);
}
@compute @workgroup_size(SHADE_BIN_GROUP) fn countBins(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) lane:u32){binTile(tile.xy,lane,false);}
@compute @workgroup_size(SHADE_BIN_GROUP) fn reserveBins(@builtin(global_invocation_id) id:vec3u){
 let bin=id.x;
 if(bin>=binCount){return;}
 let at=SHADE_BIN_META+SHADE_BIN_META_WORDS*bin;
 let quads=binsWord(at+2u,0u).x!=0u;
 let count=atomicLoad(&work[looseCounter(bin)]);
 if(count>0u){
  binsWordStore(at,0u,vec4u(count,0u,0u,0u));
  binsWordStore(at+1u,0u,vec4u(atomicAdd(&work[0],select(count,SHADE_BIN_QUAD_WORDS*count,quads)),0u,0u,0u));
  atomicStore(&work[looseCounter(bin)],0u);
  atomicStore(&work[fullCounter(bin)],0u);
 }
 let grid=groupGrid(ceilDiv(select(count,SHADE_BIN_QUAD_LANES*count,quads),SHADE_BIN_GROUP));
 args[bin*SHADE_BIN_ARGS]=grid.x;args[bin*SHADE_BIN_ARGS+1u]=grid.y;args[bin*SHADE_BIN_ARGS+2u]=1u;
}
@compute @workgroup_size(SHADE_BIN_GROUP) fn scatterBins(@builtin(workgroup_id) tile:vec3u,@builtin(local_invocation_index) lane:u32){binTile(tile.xy,lane,true);}`,
  [
    PAGE_INFO_STRUCT_WGSL,
    SHADE_UNI_WGSL,
    MATERIAL_CLASS_OF_WGSL,
    shadeBinsWgsl({ group: 0, binding: 4, access: 'read_write' }),
    shadeBinElementsWgsl({ group: 0, binding: 5, access: 'write' }),
    KERNEL_CONSTANTS_WGSL,
    GROUP_GRID_WGSL,
    ceilDivWgsl,
    lowBits,
    zOrderDecode,
  ],
)
