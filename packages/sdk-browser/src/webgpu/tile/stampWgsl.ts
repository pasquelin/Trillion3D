import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import {
  MAX_LEVELS,
  PLACE_AXIS_BITS,
  PLACE_LAYER_BITS,
  TILES_PER_LAYER,
  TILES_PER_ROW,
} from '../../texture/tiles.ts'
import { PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from './pageTable.ts'
import { TILE_USE_HEADER } from './slotUse.ts'

const AXIS_MASK = (1 << PLACE_AXIS_BITS) - 1,
  LAYER_MASK = (1 << PLACE_LAYER_BITS) - 1

/** The pool index of the place a served entry names (`entryIndex`, `../../texture/tiles.ts`). */
const TILE_ENTRY_INDEX_WGSL = wgslFn(
  'tileEntryIndex',
  [],
  `fn tileEntryIndex(word:u32)->u32{
 return ((word>>${2 * PLACE_AXIS_BITS}u)&${LAYER_MASK}u)*${TILES_PER_LAYER}u+((word>>${PLACE_AXIS_BITS}u)&${AXIS_MASK}u)*${TILES_PER_ROW}u+(word&${AXIS_MASK}u);
}`,
)

/**
 * `${k}StampUse(entry, clock)`: the place a pixel asking entry `entry` of atlas `k` READS — the
 * tile itself, or the finest resident ancestor its entry names while it streams (`pageTable.ts`)
 * — is used at `clock` (`slotUse.ts`). Its texture is the last whose level-0 first word is at or
 * before the entry's, by halves over the slots; its lane is its tail's tap (`tapOf`, the two
 * two-channel taps one lane). A zero entry reads the tail, pinned: nothing to stamp. The host
 * binds `${k}Pages` (the table) and `${k}Use` (the places' words, atomic).
 */
const stampWgsl = (k: 'color' | 'data') =>
  wgslFn(
    `${k}StampUse`,
    [TILE_ENTRY_INDEX_WGSL],
    `fn ${k}StampUse(entry:u32,clock:u32){
 let at=${k}Pages[2]+entry;let slots=${k}Pages[1];
 if(slots==0u||at>=arrayLength(&${k}Pages)){return;}
 let word=${k}Pages[at];
 if(word==0u){return;}
 let levels=${k}Pages[3];
 var lo=0u;var hi=slots;
 loop{
  if(hi-lo<=1u){break;}
  let mid=(lo+hi)/2u;
  if(${k}Pages[levels+mid*${MAX_LEVELS}u]<=at){lo=mid;}else{hi=mid;}
 }
 let lane=min(${k}Pages[${PAGE_HEADER_WORDS}u+lo*${PAGE_SLOT_WORDS}u+3u]>>24u,2u);
 let place=${TILE_USE_HEADER}u+2u*(atomicLoad(&${k}Use[lane])+tileEntryIndex(word));
 if(place<arrayLength(&${k}Use)){atomicMax(&${k}Use[place],clock);}
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
