import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { workgroupSumLoop } from '../../../gpu/core/workgroupSumWgsl.ts'
import { hasLightFunctionWgsl } from '../../lightFunction/readWgsl.ts'
import { lightingCommonWgsl } from './commonWgsl.ts'
import { LIGHT_CENTRE_FACING_WGSL } from './shadowMaskWgsl.ts'
import { lightTileCountsWgsl } from './lightTilesWgsl.ts'
import { tileLightAppendWgsl, TILE_LIGHT_REACH_WGSL } from './tileLightsWgsl.ts'

/**
 * THE LIGHTS OF EACH TILE: a workgroup a tile of the direct update's list. The tile's depth range — the least and the
 * greatest depth of the texels that hold a surface, kept as the two half floats of a word, which the pass before writes
 * (`tileDepthRangeWgsl.ts`) — bounds the tile's box in its card's space (the card's whole depth, 0 to 1, where
 * `surfaceCacheDirectLightingCullToTileDepthRange` is off); the threads walk the scene's lights between them, each its share, and keep the
 * `maxLights` of the most weight (`cullLights`, `lightSampleKey`): which lights are candidates and their weights are `tileLightsWgsl.ts`'s. Each
 * thread keeps its own best lights, ordered by key (the weight over the light's type and whether it needs a shadow mask), and the workgroup takes the greatest of their heads `maxLights` times
 * (`groupMax`): the lights a tile keeps are its heaviest first. The thread of the workgroup that leads gives the tile a light
 * tile for each (`appendTileLights`, `lightTilesWgsl.ts`).
 *
 * A light that wears a light function the atlas holds no slot of (`standalone`, a bit a light) needs a shadow mask like one that
 * casts a shadow, and is marked as such in the word that names it (`TILE_LIGHT_STANDALONE`), so that its masks are made by the
 * program of its material (`standaloneMaskWgsl.ts`).
 *
 * The tile list and the pages' records are the update context's (`contextWgsl.ts`); bindings: 0 the parameters, 1 the tables,
 * 2 the context, 3 the counters, 4 the offsets and counts of the tiles' lights, 5 the light tiles, 6 the light buffer, 7 the
 * depth ranges of the tiles, 8 the bits of the lights that hold no slot of the light functions' atlas.
 */

export const CULL_ENTRY = 'cullLights'

/** The bindings of the cull beside the tables (1) and the context (2): the counters, the offsets and counts of the tiles' lights and
 *  the light tiles written, the light buffer, the depth ranges of the tiles (`tileDepthRangeWgsl.ts`) and the bits of the lights whose
 *  light function the atlas holds no slot of, read. */
export const CULL_BINDINGS = {
  tables: 1,
  context: 2,
  counts: 3,
  cardTileOffsets: 4,
  culled: 5,
  lights: 6,
  depthRanges: 7,
  standalone: 8,
} as const

const B = CULL_BINDINGS

/** The cull program's bindings and the helpers of the workgroup's reduction and of a light's key. */
const cullHelpersWgsl =
  () => `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.depthRanges}) var<storage,read> depthRanges:array<u32>;
var<workgroup> reduction:array<u32,${WORKGROUP_THREADS}>;
/** The greatest of \`value\` over the workgroup. */
fn groupMax(lane:u32,value:u32)->u32{
 reduction[lane]=value;
 ${workgroupSumLoop(WORKGROUP_THREADS, 'reduction[lane]=max(reduction[lane],reduction[lane+stride]);')}
 let greatest=reduction[0];
 workgroupBarrier();
 return greatest;
}
/** The light's key (\`lightSampleKey\`): its rank in bits 0 to 13, its type in bits 14 and 15 (0 for a standalone light, whatever its kind), whether it needs a shadow mask
 *  (\`needsShadowMask\`) in bit 16, the weight's top bits over them. */
fn lightKey(weight:f32,rank:u32,light:DirectLight,standalone:bool)->u32{
 return ((bitcast<u32>(weight)<<1u)&0xfffe0000u)|(select(0u,0x10000u,needsShadowMask(rank,light,standalone)))|((lightKind(light,standalone)<<14u)&0xc000u)|(rank&0x3fffu);
}
`

/** The keeping of the best keys. */
const CULL_KEEP_TEXT = `/** Keeps \`key\` among the keys of \`best\`, in descending order, the least dropped. */
fn keepKey(best:ptr<function,array<u32,MAX_LIGHTS>>,keyIn:u32){
 var key=keyIn;
 for(var i=0u;i<MAX_LIGHTS;i++){
  let held=(*best)[i];
  if(key>held){(*best)[i]=key;key=held;}
 }
}
`

/** The kernel: a workgroup a tile of the direct update's list. */
const cullKernelWgsl = () => `@compute @workgroup_size(8,8,1)
fn ${CULL_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 var depths=vec2f(0.0,1.0);
 if(lgFlag(FLAG_CULL_TO_TILE_DEPTH_RANGE)){depths=unpack2x16float(depthRanges[tile]);}
 let box=tileBox(page,coord,depths);
 var best:array<u32,MAX_LIGHTS>;
 for(var i=0u;i<MAX_LIGHTS;i++){best[i]=0u;}
 for(var rank=lane;rank<directLights.count;rank+=${WORKGROUP_THREADS}u){
  let weight=tileLightWeight(rank,directLights.items[rank],box);
  if(weight>=0.0){keepKey(&best,lightKey(weight,rank,directLights.items[rank],standaloneLight(rank)));}
 }
 var kept=0u;var cursor=0u;
 for(var k=0u;k<MAX_LIGHTS;k++){
  var mine=0u;
  if(cursor<MAX_LIGHTS){mine=best[cursor];}
  let picked=groupMax(lane,mine);
  if(picked!=0u){
   if(picked==mine){cursor++;}
   if(lane==0u){tilePicks[kept]=picked;}
   kept++;
  }
 }
 if(lane==0u){appendTileLights(tile,kept);}
}`

/** The cull program for tiles that keep `maxLights` lights. */
export const cullWgsl = (maxLights: number) =>
  wgslProgram(cullHelpersWgsl() + CULL_KEEP_TEXT + cullKernelWgsl(), [
    lightingCommonWgsl({ tables: B.tables, context: { binding: B.context, access: 'read' } }),
    lightTileCountsWgsl(B.counts, 'atomic'),
    tileLightAppendWgsl(
      { culled: B.culled, cardTileOffsets: B.cardTileOffsets, standalone: B.standalone },
      maxLights,
    ),
    TILE_LIGHT_REACH_WGSL,
    LIGHT_CENTRE_FACING_WGSL,
    hasLightFunctionWgsl,
  ])
