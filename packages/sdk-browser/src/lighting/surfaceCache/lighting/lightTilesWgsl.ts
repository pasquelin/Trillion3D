import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import {
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  WORKGROUP_THREADS,
  indirectArgsWgsl,
} from '../../../gpu/dispatch/grid.ts'
import { lightingCommonWgsl } from './commonWgsl.ts'
import {
  BATCHABLE_LIGHT_TYPES,
  LIGHT_TILE_ARGS,
  LIGHT_TILE_ARGS_WORDS,
  LIGHT_TILE_COUNTS,
} from './layout.ts'

/**
 * THE LIGHT TILES OF THE DIRECT UPDATE, in the order the reference makes them (`layout.ts` says how they are laid):
 *
 * - `lightTilesClear` empties the light tiles given out, the entries given out in the tiles' lists and the light tiles each slot was
 *   given, before the cull (`cullWgsl.ts`) picks the lights of the tiles and appends a light tile to the list for each;
 * - `lightTilesOffsets`, one thread, places the tiles of each slot: the slots of the lights first, in the order of their ranks, then
 *   the types' — the running sum of the light tiles each was given. Every slot of a light has its place: a sun that needs no shadow
 *   mask is of kind 0 and lies in the slot of its rank as one that needs a mask does, and a sum that walked only the lights that
 *   need one would leave its tiles on whatever place the slot held, over another slot's;
 * - `lightTilesArgs`, a thread a slot, writes the arguments of the dispatches that follow: the groups of the compaction, of the
 *   slots of the lights together, and of each slot (a group a light tile);
 * - `lightTilesClearCompacted` empties the count of the tiles each slot has placed;
 * - `lightTilesCompact`, a thread a light tile, places each in its slot's run of the compacted list — the tile's page and tile word
 *   and its light's word — and in the list of its own tile, at the place the cull picked it (the light's word and the place of
 *   the compacted tile, which the shadow masks and the direct light share).
 *
 * The shadow masks (`shadowMaskWgsl.ts`) and the light functions apart from the atlas (`lightFunctionPassWgsl.ts`) run over a slot's
 * light tiles by its arguments; the direct light (`directWgsl.ts`) over a tile's own.
 *
 * `lightTilesClear`, `lightTilesOffsets`, `lightTilesArgs` and `lightTilesClearCompacted` bind the counters (1) and the arguments (2);
 * `lightTilesCompact` the counters (1), the update context (2), the tables (3), the culled light tiles (4), the compacted ones
 * (5), the offsets and counts of the tiles (6) and the tiles' lists of lights (7).
 */

export const LIGHT_TILE_COUNTS_ENTRIES = [
  'lightTilesClear',
  'lightTilesOffsets',
  'lightTilesArgs',
  'lightTilesClearCompacted',
] as const

export const LIGHT_TILE_COMPACT_ENTRY = 'lightTilesCompact'

/** The bindings of the program of the counters. */
export const LIGHT_TILE_COUNTS_BINDINGS = { counts: 1, args: 2 } as const

/** The bindings of the compaction. */
export const LIGHT_TILE_COMPACT_BINDINGS = {
  counts: 1,
  context: 2,
  tables: 3,
  culled: 4,
  compacted: 5,
  cardTileOffsets: 6,
  cardTileLights: 7,
} as const

const LIGHT_TILE_CONSTS = wgslBlock(
  'LIGHT_TILE_CONSTS_WGSL',
  [],
  wgslConsts({
    LT_BATCHABLE: BATCHABLE_LIGHT_TYPES,
    LT_ALLOCATOR: LIGHT_TILE_COUNTS.allocator,
    LT_CARD_TILE_ALLOCATOR: LIGHT_TILE_COUNTS.cardTileAllocator,
    LT_HEAD: LIGHT_TILE_COUNTS.head,
    LT_ARGS_COMPACTION: LIGHT_TILE_ARGS.compaction,
    LT_ARGS_LIGHTS: LIGHT_TILE_ARGS.lights,
    LT_ARGS_SLOTS: LIGHT_TILE_ARGS.slots,
    LT_ARGS_WORDS: LIGHT_TILE_ARGS_WORDS,
    LT_CULLED_INDEX_SHIFT: 14,
    LT_CULLED_INDEX_MASK: 31,
    LT_CULLED_TYPE_SHIFT: 19,
  }),
)

/** The counters at `binding`, read or (`atomic`) written, with the places of a slot's counters in them and the light tiles a slot holds. */
export const lightTileCountsWgsl = (binding: number, access: 'read' | 'atomic'): WgslDecl => {
  const atomic = access === 'atomic'
  return wgslBlock(
    `LIGHT_TILE_COUNTS_WGSL(${binding},${access})`,
    [LIGHT_TILE_CONSTS],
    `@group(0) @binding(${binding}) var<storage,${atomic ? 'read_write' : 'read'}> lightTileCounts:array<${atomic ? 'atomic<u32>' : 'u32'}>;
fn lightTileCount(i:u32)->u32{return ${atomic ? 'atomicLoad(&lightTileCounts[i])' : 'lightTileCounts[i]'};}
/** The slots the counters hold: after the head, three arrays of as many counters. */
fn lightSlots()->u32{return (arrayLength(&lightTileCounts)-LT_HEAD)/3u;}
/** The counters of slot \`slot\`: the light tiles the cull gave it, the ones the compaction has placed and the place its tiles begin at. */
fn givenAt(slot:u32)->u32{return LT_HEAD+slot;}
fn placedAt(slot:u32)->u32{return LT_HEAD+lightSlots()+slot;}
fn offsetAt(slot:u32)->u32{return LT_HEAD+2u*lightSlots()+slot;}
/** The light tiles of slot \`slot\`: from \`.x\` up to, not including, \`.y\` in the compacted list. */
fn slotTiles(slot:u32)->vec2u{
 let first=lightTileCount(offsetAt(slot));
 return vec2u(first,first+lightTileCount(givenAt(slot)));
}
/** The light tiles of every slot of a light together: the kinds' slots, which follow them, begin where they end. */
fn perLightTiles()->vec2u{return vec2u(0u,lightTileCount(offsetAt(0u)));}`,
  )
}

/** The slot a light tile of kind \`kind\` (the key's: 0 for a sun or a light apart from the atlas, 1 a point light, 2 a spot, 3 a rectangle)
 *  and rank \`rank\` lies in: the kind's where the lights are batched by type and it is one of the batchable, else the rank's. */
const LIGHT_TILE_SLOT = wgslBlock(
  'LIGHT_TILE_SLOT_WGSL',
  [LIGHT_TILE_CONSTS],
  `fn lightTileSlot(kind:u32,rank:u32)->u32{
 return select(LT_BATCHABLE+rank,kind-1u,lgFlag(FLAG_LIGHT_TILES_PER_TYPE)&&kind>0u);
}`,
)

/** A light tile as the cull appends it: its tile in the update's list, then the light's word (its rank and the standalone bit), the
 *  place of the light among the tile's and its kind. */
export const CULLED_LIGHT_TILE_WGSL = wgslBlock(
  'CULLED_LIGHT_TILE_WGSL',
  [LIGHT_TILE_CONSTS, LIGHT_TILE_SLOT],
  `fn culledTileWord(light:u32,place:u32,kind:u32)->u32{
 return light|(place<<LT_CULLED_INDEX_SHIFT)|(kind<<LT_CULLED_TYPE_SHIFT);
}
fn culledPlace(word:u32)->u32{return (word>>LT_CULLED_INDEX_SHIFT)&LT_CULLED_INDEX_MASK;}
fn culledKind(word:u32)->u32{return (word>>LT_CULLED_TYPE_SHIFT)&3u;}
/** The light's word of a culled tile: its rank and whether it is apart from the atlas. */
fn culledLight(word:u32)->u32{return word&(TILE_LIGHT_RANK_MASK|TILE_LIGHT_STANDALONE);}`,
)

const countsProgram = () =>
  wgslProgram(
    `@group(0) @binding(${LIGHT_TILE_COUNTS_BINDINGS.args}) var<storage,read_write> lightTileArgs:array<u32>;
fn setArgs(entry:u32,groups:vec2u){writeIndirectArgs(entry,groups.x,groups.y,1u);}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn lightTilesClear(@builtin(local_invocation_index) lane:u32){
 for(var i=lane;i<LT_HEAD+lightSlots();i+=${WORKGROUP_THREADS}u){atomicStore(&lightTileCounts[i],0u);}
}
@compute @workgroup_size(1)
fn lightTilesOffsets(){
 var offset=0u;
 for(var slot=LT_BATCHABLE;slot<lightSlots();slot++){
  atomicStore(&lightTileCounts[offsetAt(slot)],offset);
  offset+=lightTileCount(givenAt(slot));
 }
 for(var slot=0u;slot<LT_BATCHABLE;slot++){
  atomicStore(&lightTileCounts[offsetAt(slot)],offset);
  offset+=lightTileCount(givenAt(slot));
 }
}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn lightTilesArgs(@builtin(global_invocation_id) id:vec3u){
 let slot=id.x;
 if(slot==0u){
  setArgs(LT_ARGS_COMPACTION,groupGrid(ceilDiv(lightTileCount(LT_ALLOCATOR),${WORKGROUP_THREADS}u)));
  setArgs(LT_ARGS_LIGHTS,groupGrid(perLightTiles().y));
 }
 if(slot<lightSlots()){setArgs(LT_ARGS_SLOTS+slot,groupGrid(lightTileCount(givenAt(slot))));}
}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn lightTilesClearCompacted(@builtin(local_invocation_index) lane:u32){
 for(var i=lane;i<lightSlots();i+=${WORKGROUP_THREADS}u){atomicStore(&lightTileCounts[placedAt(i)],0u);}
}`,
    [
      lightTileCountsWgsl(LIGHT_TILE_COUNTS_BINDINGS.counts, 'atomic'),
      GROUP_GRID_WGSL,
      indirectArgsWgsl('lightTileArgs', { words: 'LT_ARGS_WORDS' }),
    ],
  )

/** The program of the counters: the clears, the offsets of the slots and the arguments of the dispatches. */
export const LIGHT_TILE_COUNTS_WGSL = countsProgram()

const C = LIGHT_TILE_COMPACT_BINDINGS

/** The compaction of the light tiles. */
export const LIGHT_TILE_COMPACT_WGSL = wgslProgram(
  `@group(0) @binding(${C.culled}) var<storage,read> culledTiles:array<u32>;
@group(0) @binding(${C.compacted}) var<storage,read_write> compactedTiles:array<u32>;
@group(0) @binding(${C.cardTileOffsets}) var<storage,read> cardTileOffsets:array<u32>;
@group(0) @binding(${C.cardTileLights}) var<storage,read_write> cardTileLights:array<u32>;
@compute @workgroup_size(${WORKGROUP_THREADS})
fn ${LIGHT_TILE_COMPACT_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(id,n,${WORKGROUP_THREADS}u);
 if(i>=lightTileCount(LT_ALLOCATOR)){return;}
 let cardTile=culledTiles[i*LIGHT_TILE_WORDS];
 let word=culledTiles[i*LIGHT_TILE_WORDS+1u];
 let light=culledLight(word);
 let slot=lightTileSlot(culledKind(word),tileLightRank(light));
 let placed=lightTileCount(offsetAt(slot))+atomicAdd(&lightTileCounts[placedAt(slot)],1u);
 compactedTiles[placed*LIGHT_TILE_WORDS]=ctxTile(LG_LIST_DIRECT,cardTile);
 compactedTiles[placed*LIGHT_TILE_WORDS+1u]=light;
 let own=(cardTileOffsets[cardTile*CARD_TILE_OFFSET_WORDS]+culledPlace(word))*LIGHT_TILE_WORDS;
 cardTileLights[own]=light;
 cardTileLights[own+1u]=placed;
}`,
  [
    lightingCommonWgsl({ tables: C.tables, context: { binding: C.context, access: 'read' } }),
    lightTileCountsWgsl(C.counts, 'atomic'),
    LIGHT_TILE_SLOT,
    CULLED_LIGHT_TILE_WGSL,
    FLAT_INDEX_WGSL,
  ],
)
