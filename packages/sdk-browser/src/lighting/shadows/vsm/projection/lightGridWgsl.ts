/**
 * THE SHADOWED LIGHTS' GRID: for each cell of the view's light grid, the list of its local lights that
 * the virtual shadow maps shadow, as the reference prunes its light grid once a frame, before the page
 * marking (`../markingPass.ts`); the marking and the projection both read that one grid, the marking
 * as the engine's light grid (its head copied). A
 * cell's list keeps the lights in the order the cell lists them, those whose map holds many pages
 * first, the lights whose map is a single page after them; a light without a shadow is left out. The
 * local lights' projection packs its mask in that order (`projectionEntryWgsl.ts`), and the lighting
 * finds a light's lane in it (`vsmMaskLaneOf`, `../../../direct/shadowTraceWgsl.ts`).
 *
 * The grid is a buffer of words laid out as the light grid's own (`tileLights`): a cell's count at the
 * first word of its record, where its list starts at the second, its list where the cell's list starts
 * in the pool. The readers read the pruned grid alone: the light grid's pool is laid out again every
 * image, and a projection held over images (`vsmProjectionHold.ts`) keeps the lists it packed by. A
 * cell always has its list, whatever the pool held (the view's grid drops the lights asked past
 * its capacity, `../../../tiles/compactWgsl.ts`), and a pixel past the grid reads its last cell
 * (`gridCell`). Only an image with no grid (`TILE_NO_SLICE`) has no list: its readers walk every
 * light of the scene in the same order (`vsmShadowedWalk`).
 *
 * Its host declares `directLights` and `vsmLightGrid` (and, for the pruning, `tileLights`), and holds
 * `LIGHT_GRID_WGSL`.
 */
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { LOCAL_SHADOWED_WGSL, SHADOW_SLICE_WGSL } from '../../../direct/shadowSlice.ts'
import {
  DIRECT_LIGHT_WGSL,
  LIGHT_GRID_WGSL as ENGINE_LIGHT_GRID_WGSL,
} from '../../../direct/lightWgsl.ts'
import { VIEW_WGSL } from '../../../deferred/worldAtWgsl.ts'

/** Threads of a group of the pruning kernel. */
export const VSM_LIGHT_GRID_GROUP = 64

/** The pruning kernel's entry. */
export const VSM_PRUNE_LIGHT_GRID_ENTRY = 'vsmPruneLightGrid'

/** The reads of the grid, the projection's and the lighting's. */
export const VSM_LIGHT_GRID_WGSL = wgslBlock(
  'VSM_LIGHT_GRID_WGSL',
  [LOCAL_SHADOWED_WGSL, SHADOW_SLICE_WGSL],
  `
/** Whether the light of rank \`rank\` is a local light the maps shadow, of the pass \`phase\` of the
 *  order: 0, a map of many pages; 1, a map of a single page. */
fn vsmShadowedOf(rank:u32,phase:u32)->bool{
 return lightHasLocalShadow(rank)&&u32(shadowSliceDistant(i32(directLights.items[rank].params.y)))==phase;
}
/** The lane past every shadowed light: a walk that counts them all. */
const VSM_WALK_ALL:u32=0xffffffffu;
/** Over every light of the scene in the grid's order (an image with no grid): the rank of the
 *  shadowed light of lane \`lane\` (x), and the shadowed lights met up to it, all of them when the lane is
 *  past them (y). */
fn vsmShadowedWalk(lane:u32)->vec2u{
 var met=0u;
 for(var phase=0u;phase<2u;phase++){
  for(var rank=0u;rank<directLights.count;rank++){
   if(!vsmShadowedOf(rank,phase)){continue;}
   if(met==lane){return vec2u(rank,met+1u);}
   met++;
  }
 }
 return vec2u(0u,met);
}
/** The shadowed lights of the cell whose record starts at \`base\`, as the grid's pruning wrote them: where
 *  their list starts (x) and how many (y); \`TILE_NO_SLICE\` in x for an image with no grid, whose
 *  count is walked. Read from the pruned grid alone, so a projection held over images keeps the lists it
 *  packed its mask by. */
fn vsmShadowedList(base:u32)->vec2u{
 if(base==TILE_NO_SLICE){return vec2u(TILE_NO_SLICE,vsmShadowedWalk(VSM_WALK_ALL).y);}
 return vec2u(vsmLightGrid[base+1u],vsmLightGrid[base]);
}
/** The rank of the shadowed light of lane \`lane\` in the list \`list\` (\`vsmShadowedList\`). */
fn vsmShadowedRank(list:vec2u,lane:u32)->u32{
 if(list.x==TILE_NO_SLICE){return vsmShadowedWalk(lane).x;}
 return vsmLightGrid[list.x+lane];
}`,
)

/** The pruning kernel: a thread a cell of the view's grid writes the cell's count, where its list starts and
 *  its list, and the first threads the grid's head (its slice map), so that the grid is read as the
 *  light grid itself (`cellSlice`, `gridCell`). Its host declares the view (`view`, whose
 *  `lightParams.yz` are the grid's columns) and the grid read-write. */
const VSM_PRUNE_KERNEL_WGSL = wgslBlock(
  'VSM_PRUNE_KERNEL_WGSL',
  [VIEW_WGSL, DIRECT_LIGHT_WGSL, ENGINE_LIGHT_GRID_WGSL, VSM_LIGHT_GRID_WGSL],
  `
@compute @workgroup_size(${VSM_LIGHT_GRID_GROUP})
fn ${VSM_PRUNE_LIGHT_GRID_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(id.x<GRID_HEAD){vsmLightGrid[id.x]=tileLights[id.x];}
 let columns=vec2u(view.lightParams.yz);
 if(id.x>=columns.x*columns.y*GRID_SLICES){return;}
 let base=GRID_HEAD+id.x*TILE_STRIDE;
 let first=tileLights[base+1u];
 var kept=0u;
 if((tileLights[base]&TILE_SHADOWED)!=0u){
  let count=tileLights[base]&~TILE_SHADOWED;
  for(var phase=0u;phase<2u;phase++){
   for(var index=0u;index<count;index++){
    let rank=tileLights[first+index];
    if(vsmShadowedOf(rank,phase)){
     vsmLightGrid[first+kept]=rank;
     kept++;
    }
   }
  }
 }
 vsmLightGrid[base]=kept;
 vsmLightGrid[base+1u]=first;
}
`,
)

/** The bindings of the pruning's one group, in order. */
export const VSM_PRUNE_BINDING = { view: 0, directLights: 1, tileLights: 2, lightGrid: 3 } as const

/** The pruning's program: the view, the lights and the light grid it reads, the shadowed lights' grid it
 *  writes. */
export const vsmPruneLightGridWgsl = () =>
  wgslProgram(
    `@group(0) @binding(${VSM_PRUNE_BINDING.view}) var<uniform> view:View;
@group(0) @binding(${VSM_PRUNE_BINDING.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${VSM_PRUNE_BINDING.tileLights}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${VSM_PRUNE_BINDING.lightGrid}) var<storage,read_write> vsmLightGrid:array<u32>;
`,
    [VSM_PRUNE_KERNEL_WGSL],
  )
