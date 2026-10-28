import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/texture/previewFormat.ts'
import { TILE_SIZE } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { MAX_LEVELS, TILES_PER_LAYER, TILES_PER_ROW } from '../texture/tiles.ts'
import {
  PAGE_HEADER_WORDS,
  PAGE_SLOT_WORDS,
  SIBLING_BIAS_MASK,
  SIBLING_BIAS_ORIGIN,
  SIBLING_BIAS_SHIFT,
  SIBLING_CAP,
  SIBLING_DATA,
  SIBLING_SLOT_MASK,
} from './page/pageTable.ts'
import { TILE_PLACE_WORD_WGSL } from './slotUse.ts'
import { POOL_PLACE_WGSL } from './pool/poolPlaceWgsl.ts'

/** The pool index of the place a served entry names (`entryIndex`, `../texture/tiles.ts`), off
 *  the one place decoder (`placeFields`). */
const TILE_ENTRY_INDEX_WGSL = wgslFn(
  'tileEntryIndex',
  [POOL_PLACE_WGSL],
  `fn tileEntryIndex(word:u32)->u32{
 let place=placeFields(word);
 return place.z*${TILES_PER_LAYER}u+place.y*${TILES_PER_ROW}u+place.x;
}`,
)

/**
 * `${k}StampPlace(slot, word, clock)`: the place the served entry `word` of texture `slot` of atlas
 * `k` names is used at `clock` (`slotUse.ts`): its lane is its texture's tail's tap (`tapOf`, the
 * two two-channel taps one lane, the half-float tap the colour atlas's third, the one-channel taps
 * the data atlas's third). The host binds `${k}Pages` (the table) and `${k}Use` (the places' words,
 * atomic).
 */
const stampPlaceWgsl = (k: 'color' | 'data') =>
  wgslFn(
    `${k}StampPlace`,
    [TILE_ENTRY_INDEX_WGSL, TILE_PLACE_WORD_WGSL],
    `fn ${k}StampPlace(slot:u32,word:u32,clock:u32){
 let lane=min(${k}Pages[${PAGE_HEADER_WORDS}u+slot*${PAGE_SLOT_WORDS}u+3u]>>24u,${PREVIEW_LAYOUT_NAMES.length - 1}u);
 let place=tilePlaceWord(atomicLoad(&${k}Use[lane]),tileEntryIndex(word));
 if(place<arrayLength(&${k}Use)){atomicMax(&${k}Use[place],clock);}
}`,
  )

/** `stampTiles(size, level)`: the tile columns and rows of `level` of a texture of header word `size`. */
const STAMP_TILES_WGSL = wgslFn(
  'stampTiles',
  [],
  `fn stampTiles(size:u32,level:u32)->vec2u{
 return vec2u((max(1u,(size&0xffffu)>>level)+${TILE_SIZE - 1}u)/${TILE_SIZE}u,(max(1u,(size>>16u)>>level)+${TILE_SIZE - 1}u)/${TILE_SIZE}u);
}`,
)

/**
 * `${k}StampTile(slot, bias, level, tx, ty, clock)`: texture `slot` of atlas `k`, a sibling of the
 * texture a pixel reads (`pageTable.ts`), is read at the tile the same place of the image names in
 * it, and its place is used at `clock`: the one its entry names, the tile or the ancestor serving it.
 * `bias` is the log2 of the ratio of the pixel's texture to the sibling (`stacks.ts`): the sibling's
 * level is the pixel's less `bias`, held at its finest, where its tile is the pixel's tile shifted
 * down by the levels it was held up — a stack of maps of several sizes reads one image, as the
 * reference's mip bias of a stack's layers does. A missing tile is asked of nobody on its siblings'
 * behalf; the request stays the pixel's pick's.
 */
const stampTileWgsl = (k: 'color' | 'data') =>
  wgslFn(
    `${k}StampTile`,
    [stampPlaceWgsl(k), STAMP_TILES_WGSL],
    `fn ${k}StampTile(slot:u32,bias:i32,level:u32,tx:u32,ty:u32,clock:u32){
 if(slot>=${k}Pages[1]){return;}
 let head=${PAGE_HEADER_WORDS}u+slot*${PAGE_SLOT_WORDS}u;
 let own=i32(level)-bias;
 let lvl=u32(max(own,0));
 if(lvl>=(${k}Pages[head+1u]&0xffu)){return;}
 let up=u32(max(-own,0));
 let tiles=stampTiles(${k}Pages[head],lvl);
 let x=tx>>up;let y=ty>>up;
 if(x>=tiles.x||y>=tiles.y){return;}
 let at=${k}Pages[${k}Pages[3]+slot*${MAX_LEVELS}u+lvl]+y*tiles.x+x;
 if(at>=arrayLength(&${k}Pages)){return;}
 let word=${k}Pages[at];
 if(word==0u){return;}
 ${k}StampPlace(slot,word,clock);
}`,
  )

/**
 * `${k}StampUse(entry, clock)`: the place a pixel asking entry `entry` of atlas `k` READS — the
 * tile itself, or the finest resident ancestor its entry names while it streams (`page/pageTable.ts`)
 * — is used at `clock` (`slotUse.ts`), and so is the place each sibling of its texture reads at the
 * same level and tile of the image: a pixel names one pick of its material's maps, and the others it
 * reads are as read. Its texture is the last whose level-0 first word is at or before the entry's, by
 * halves over the slots. A zero entry reads the tail, pinned: nothing to stamp.
 */
const stampWgsl = (k: 'color' | 'data') =>
  wgslFn(
    `${k}StampUse`,
    [stampPlaceWgsl(k), stampTileWgsl('color'), stampTileWgsl('data')],
    `fn ${k}StampUse(entry:u32,clock:u32){
 let at=${k}Pages[2]+entry;let slots=${k}Pages[1];
 if(slots==0u||at>=arrayLength(&${k}Pages)){return;}
 let word=${k}Pages[at];
 if(word==0u){return;}
 let levels=${k}Pages[3];
 var lo=0u;var hi=slots;
 loop{
  if(hi-lo<=1u){break;}
  let mid=(lo+hi)>>1u;
  if(${k}Pages[levels+mid*${MAX_LEVELS}u]<=at){lo=mid;}else{hi=mid;}
 }
 ${k}StampPlace(lo,word,clock);
 // A texture with no siblings, the common one, stops here.
 let listed=${k}Pages[2]-slots*${SIBLING_CAP}u+lo*${SIBLING_CAP}u;
 if(${k}Pages[listed]==0u){return;}
 let head=${PAGE_HEADER_WORDS}u+lo*${PAGE_SLOT_WORDS}u;
 var level=0u;
 for(var l=1u;l<(${k}Pages[head+1u]&0xffu);l++){
  if(${k}Pages[levels+lo*${MAX_LEVELS}u+l]<=at){level=l;}else{break;}
 }
 let index=at-${k}Pages[levels+lo*${MAX_LEVELS}u+level];
 let across=stampTiles(${k}Pages[head],level).x;
 let tx=index%across;let ty=index/across;
 for(var i=0u;i<${SIBLING_CAP}u;i++){
  let sibling=${k}Pages[listed+i];
  if(sibling==0u){break;}
  let slot=sibling&${SIBLING_SLOT_MASK}u;
  let bias=i32((sibling>>${SIBLING_BIAS_SHIFT}u)&${SIBLING_BIAS_MASK}u)-${SIBLING_BIAS_ORIGIN};
  if((sibling&${SIBLING_DATA}u)!=0u){dataStampTile(slot,bias,level,tx,ty,clock);}else{colorStampTile(slot,bias,level,tx,ty,clock);}
 }
}`,
  )

/** `tileStampRank(rank, clock)`: the place a feedback rank reads, in the atlas whose ranks hold
 *  it — the data ranks behind the colour ones, from `dataPages[0]` on. */
export const TILE_STAMP_WGSL = wgslBlock(
  'TILE_STAMP_WGSL',
  [stampWgsl('color'), stampWgsl('data')],
  `fn tileStampRank(rank:u32,clock:u32){
 let dataAt=dataPages[0];
 if(rank<dataAt){colorStampUse(rank-colorPages[0],clock);}else{dataStampUse(rank-dataAt,clock);}
}
`,
)
