import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { PREVIEW_LAYOUT_NAMES } from '../../../../sdk-core/src/index.ts'
import { MAX_LEVELS, TILES_PER_LAYER, TILES_PER_ROW } from '../../texture/tiles.ts'
import { PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from './pageTable.ts'
import { TILE_PLACE_WORD_WGSL } from './slotUse.ts'
import { POOL_PLACE_WGSL } from './poolPlaceWgsl.ts'

/** The pool index of the place a served entry names (`entryIndex`, `../../texture/tiles.ts`), off
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
    [TILE_ENTRY_INDEX_WGSL, TILE_PLACE_WORD_WGSL],
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
 let lane=min(${k}Pages[${PAGE_HEADER_WORDS}u+lo*${PAGE_SLOT_WORDS}u+3u]>>24u,${PREVIEW_LAYOUT_NAMES.length - 1}u);
 let place=tilePlaceWord(atomicLoad(&${k}Use[lane]),tileEntryIndex(word));
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
