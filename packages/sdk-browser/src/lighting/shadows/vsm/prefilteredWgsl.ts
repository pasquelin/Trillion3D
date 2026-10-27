/**
 * THE PREFILTERED DISTANT SHADOW'S SHADER TEXT (`shadowPrefilteredDistant`): the constants of
 * `prefilteredConstants.ts` and the helpers over a record, a page table entry and a level's texel, listed
 * by the programs of a set that holds the feature (`prefilteredDeps`); a set without it compiles the text
 * it always did.
 */
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import {
  VSM_ENTRY_SECONDARY_BIT,
  VSM_FILTER_ARGS_BORDER,
  VSM_FILTER_ARGS_MERGE,
  VSM_FILTER_ARGS_SEPARABLE,
  VSM_FILTER_ARGS_SET_WORDS,
  VSM_FILTER_LIST_FILTERABLE,
  VSM_FILTER_LIST_SEPARABLE,
  VSM_FILTERABLE_BORDER,
  VSM_FILTERABLE_PAGE_BYTES,
  VSM_FILTERABLE_PAGE_SIZE,
  VSM_HISTORY_BLEND_WORD,
  VSM_HISTORY_COVER_WORD,
  VSM_HISTORY_IDS_WORD,
  VSM_HISTORY_RECORDS_WORD,
  VSM_HISTORY_SUN_WORD,
  VSM_HISTORY_TABLE_WORD,
  VSM_MAP_LEVEL_INDEX_MASK,
  VSM_MAP_LEVEL_INDEX_SHIFT,
  VSM_MAP_PREFILTERED_DISTANT,
  VSM_PAGE_AUX_MASK,
  VSM_PAGE_PRIMARY,
  VSM_PAGE_SECONDARY,
} from './prefilteredConstants.ts'
import { VSM_PAGE_ADDRESS_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projection/projectionDataWgsl.ts'

/** The constants above and the helpers over a record, a page table entry and a level's texel. */
export const VSM_PREFILTERED_WGSL = wgslBlock(
  'VSM_PREFILTERED_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_PROJECTION_DATA_WGSL],
  `
${wgslConsts({
  VSM_PAGE_PRIMARY,
  VSM_PAGE_SECONDARY,
  VSM_PAGE_AUX_MASK,
  VSM_ENTRY_SECONDARY_BIT,
  VSM_MAP_PREFILTERED_DISTANT,
  VSM_MAP_LEVEL_INDEX_SHIFT,
  VSM_MAP_LEVEL_INDEX_MASK,
  VSM_FILTERABLE_BORDER,
  VSM_FILTERABLE_PAGE_SIZE,
  VSM_FILTERABLE_PAGE_BYTES,
  VSM_FILTER_ARGS_SET_WORDS,
  VSM_FILTER_ARGS_SEPARABLE,
  VSM_FILTER_ARGS_MERGE,
  VSM_FILTER_ARGS_BORDER,
  VSM_FILTER_LIST_SEPARABLE,
  VSM_FILTER_LIST_FILTERABLE,
})}
/** Whether a page table entry is a secondary request: its page holds a filtered pool page. */
fn vsmEntrySecondary(entry:u32)->bool{return (entry&VSM_ENTRY_SECONDARY_BIT)!=0u;}
/** The entry of a page just granted, valid for rendering, \`secondary\` when a finer level's page
 *  falls back on it. */
fn vsmPackSecondaryTableEntry(physicalAddress:vec2u,secondary:bool)->u32{
 return vsmPackTableEntry(physicalAddress,true)|select(0u,VSM_ENTRY_SECONDARY_BIT,secondary);
}
/** Whether the map is a level of a clipmap that holds a prefiltered distant shadow. */
fn vsmMapPrefiltered(pd:VsmProjectionData)->bool{return (pd.flags&VSM_MAP_PREFILTERED_DISTANT)!=0u;}
/** The map's index in its clipmap, 0 for the finest level; set where \`vsmMapPrefiltered\`. */
fn vsmClipmapLevelIndex(pd:VsmProjectionData)->u32{return (pd.flags>>VSM_MAP_LEVEL_INDEX_SHIFT)&VSM_MAP_LEVEL_INDEX_MASK;}
/** The place of a texel \`texel\` of a level's map: its page, and where it lies in it. */
struct VsmLevelTexel{vPage:vec2i,inPage:vec2f,}
fn vsmLevelTexelAt(texel:vec2f)->VsmLevelTexel{
 let vPage=vec2i(floor(texel*(1.0/f32(VSM_PAGE_TEXELS))));
 return VsmLevelTexel(vPage,texel-vec2f(vPage*i32(VSM_PAGE_TEXELS)));
}
`,
)

/** The history's header words, through the module's \`vsmFilterableHistoryLoad(i:u32)->u32\`
 *  (\`filterableHistory\`). */
export const VSM_HISTORY_WGSL = wgslBlock(
  'VSM_HISTORY_WGSL',
  [],
  `
${wgslConsts({ VSM_HISTORY_BLEND_WORD, VSM_HISTORY_SUN_WORD })}
fn vsmHistoryRecordsWord()->u32{return vsmFilterableHistoryLoad(${VSM_HISTORY_RECORDS_WORD}u);}
fn vsmHistoryTableWord()->u32{return vsmFilterableHistoryLoad(${VSM_HISTORY_TABLE_WORD}u);}
fn vsmHistoryCoverWord()->u32{return vsmFilterableHistoryLoad(${VSM_HISTORY_COVER_WORD}u);}
fn vsmHistoryIdsWord()->u32{return vsmFilterableHistoryLoad(${VSM_HISTORY_IDS_WORD}u);}
/** The share of the previous frame the filter keeps: 0 while the history is not valid. */
fn vsmHistoryBlend()->f32{return bitcast<f32>(vsmFilterableHistoryLoad(VSM_HISTORY_BLEND_WORD));}
/** The id of the current frame's first sun map: the sun maps' place in the history is their id less it. */
fn vsmHistorySunBase()->u32{return vsmFilterableHistoryLoad(VSM_HISTORY_SUN_WORD);}
`,
)

/** The prefiltered block a program lists when its layout holds the feature. */
export const prefilteredDeps = (on: boolean) => (on ? [VSM_PREFILTERED_WGSL] : [])
