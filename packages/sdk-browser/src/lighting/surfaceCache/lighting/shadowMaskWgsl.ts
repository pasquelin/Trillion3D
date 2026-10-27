import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { CARD_TILE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import type { CloudShadowBindings } from '../../atmosphere/cloudShadowRead.ts'
import { cloudShadowReadWgsl } from '../../atmosphere/cloudShadowRead.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { declaredLightWgsl } from '../../direct/lightLoopWgsl.ts'
import {
  hasLightFunctionWgsl,
  lightFunctionReadWgsl,
  type LightFunctionBindings,
} from '../../lightFunction/readWgsl.ts'
import {
  CM_PER_M_WGSL,
  lightingCommonWgsl,
  lightingLayersWgsl,
  surfaceTexelWgsl,
} from './commonWgsl.ts'
import {
  PAGE_LIGHTING,
  SHADOW_FACTOR_TILE_WORDS,
  SHADOW_LIGHT_TILE_WORDS,
  SHADOW_MASK,
  SHADOW_TEXELS,
  SHADOW_TRACE,
} from './layout.ts'

/**
 * THE SHADOW MASK OF A LIGHT ON A TILE, and what the shadow traces and the direct light read of it (`layout.ts` says how
 * it is laid): a byte a texel of the tile's 8 × 8, the light's factor on 7 bits — the share of the light the texel
 * receives, 127 for all of it — and, in the top bit, whether the factor is settled. A texel that no light reaches is settled
 * at 0. One that does starts at 1, unsettled; the light's function multiplies the factor and then the clouds' shade, each
 * settling the texel when the factor falls to 0.01 or less; a light that casts no shadow settles it too. What is left
 * unsettled is a shadow trace (`shadowTraceWgsl.ts`), one word naming the light tile and the texel, which multiplies the factor by 0 or 1 and settles it.
 *
 * `shadowMask` makes the masks: a workgroup a tile of the direct list, a thread a texel, which walks the lights the tile
 * keeps (`cullWgsl.ts`) one after the other — the count is the tile's, so the walk is the workgroup's —: for each, the
 * texels' masks, and the ones left unsettled listed as shadow traces, packed with a count in front. Where the tile
 * was uniformly visible to the light, or uniformly shadowed, at its last update (`factors`, one bit a light, 256 lights a
 * tile of the atlas) and every texel of a quad of four is unsettled, only one of the four is listed, the one
 * the page's direct update number picks, and the trace answers the quad. The pass writes the page and tile word and
 * the rank of each light tile (`lightTiles`), which the traces read their texel's page, tile and light from. The
 * light tile of the light `k` of the tile `t` is `t * maxLights + k`. The count of the traces is emptied by the context's
 * clear (`contextWgsl.ts`).
 *
 * Bindings: 0 the parameters, 1 the tables, 2 the context, 3 and 4 the depth and normal layers, 5 the lights of the tiles,
 * 6 the masks, 7 the lights, 8 the light functions, 9 to 12 the clouds' shade (9 is their uniform block), 13 the factor
 * atlas, 14 the shadow traces, 15 the light tiles. Eight storage buffers: the tables, the context, the lights of the tiles, the
 * masks, the lights, the factors, the traces and the light tiles.
 */

/** The bits of a texel's byte and the least settled factor, as the kernels pack them. */
const SHADOW_FACTOR_MAX = (1 << SHADOW_MASK.factorBits) - 1
const SHADOW_COMPLETE = 1 << SHADOW_MASK.factorBits
const SHADOW_BYTE_MASK = (1 << SHADOW_MASK.rayBits) - 1
/** The factor above which a texel sees its light (`IsVisibleToLight`): a texel under it is settled. */
const SHADOW_VISIBLE_ABOVE = 0.01

const SHADOW_CONSTS = wgslConsts({
  SHADOW_FACTOR_MAX,
  SHADOW_COMPLETE,
  SHADOW_BYTE_MASK,
  SHADOW_RAY_BITS: SHADOW_MASK.rayBits,
  SHADOW_MASK_TILE_WORDS: SHADOW_MASK.tileWords,
  SHADOW_LIGHT_TILE_WORDS,
  SHADOW_LIGHT_TILE_MASK: 2 ** SHADOW_TRACE.lightTileBits - 1,
  SHADOW_X_SHIFT: SHADOW_TRACE.xShift,
  SHADOW_Y_SHIFT: SHADOW_TRACE.yShift,
  SHADOW_DOWN_SHIFT: SHADOW_TRACE.downsampleShift,
  SHADOW_COORD_MASK: SHADOW_TRACE.coordMask,
  SHADOW_QUAD_MASK: SHADOW_TRACE.quadMask,
  SHADOW_DOWN_MASK: SHADOW_TRACE.downsampleMask,
  FACTOR_LIGHTS_MASK: SHADOW_FACTOR_TILE_WORDS * 32 - 1,
})

/** The factor atlas's addressing, shared by every kernel that reads or writes it: its tiles are `FACTOR_TILE_WORDS` words each. */
export const SHADOW_FACTOR_ATLAS_WGSL = wgslBlock(
  'SHADOW_FACTOR_ATLAS_WGSL',
  [],
  `${wgslConsts({ FACTOR_TILE_WORDS: SHADOW_FACTOR_TILE_WORDS })}
/** The first word of the tile \`tile\` of a factor atlas \`tilesAlong\` tiles wide. */
fn factorTileWord(tile:vec2u,tilesAlong:u32)->u32{return FACTOR_TILE_WORDS*(tile.y*tilesAlong+tile.x);}
`,
)

/** The masks' and the traces' packing and the factor atlas's addressing, shared by every kernel that reads them. */
export const SHADOW_MASK_WGSL = wgslBlock(
  'SHADOW_MASK_WGSL',
  [SHADOW_FACTOR_ATLAS_WGSL],
  `${SHADOW_CONSTS}
/** A texel's factor and whether it is settled. */
struct ShadowRay{factor:f32,complete:bool}
fn isVisibleToLight(factor:f32)->bool{return factor>${SHADOW_VISIBLE_ABOVE};}
/** The byte of a ray: its factor truncated to 7 bits, the top bit set where it is settled. */
fn shadowByteOf(ray:ShadowRay)->u32{return u32(saturate(ray.factor)*f32(SHADOW_FACTOR_MAX))|select(0u,SHADOW_COMPLETE,ray.complete);}
fn shadowRayOf(byte:u32)->ShadowRay{return ShadowRay(f32(byte&SHADOW_FACTOR_MAX)/f32(SHADOW_FACTOR_MAX),(byte&SHADOW_COMPLETE)!=0u);}
/** The bit of the texel \`coord\` of a tile in its mask's words, and the byte that starts at \`bit\` of a mask's word. */
fn shadowBit(coord:vec2u)->u32{return SHADOW_RAY_BITS*(coord.x+coord.y*LG_TILE);}
fn shadowByteIn(word:u32,bit:u32)->u32{return (word>>(bit%32u))&SHADOW_BYTE_MASK;}
/** A trace word: the light tile, the texel and the downsample level, and each of them back. */
fn packShadowTrace(lightTile:u32,coord:vec2u,downsample:u32)->u32{
 return (lightTile&SHADOW_LIGHT_TILE_MASK)|((coord.x&SHADOW_COORD_MASK)<<SHADOW_X_SHIFT)|((coord.y&SHADOW_COORD_MASK)<<SHADOW_Y_SHIFT)|((downsample&SHADOW_DOWN_MASK)<<SHADOW_DOWN_SHIFT);
}
fn shadowTraceLightTile(word:u32)->u32{return word&SHADOW_LIGHT_TILE_MASK;}
fn shadowTraceCoord(word:u32)->vec2u{return vec2u((word>>SHADOW_X_SHIFT)&SHADOW_COORD_MASK,(word>>SHADOW_Y_SHIFT)&SHADOW_COORD_MASK);}
fn shadowTraceDownsample(word:u32)->u32{return (word>>SHADOW_DOWN_SHIFT)&SHADOW_DOWN_MASK;}
/** The first word of the factors of the tile \`coord\` of the page \`page\`, and the word and bit of light \`rank\` in them. */
fn cardTileFactorWord(page:u32,coord:vec2u)->u32{return factorTileWord((pageMin(page)+coord*LG_TILE)/LG_TILE,lp.atlasSide/LG_TILE);}
fn factorWordOf(rank:u32)->u32{return (rank&FACTOR_LIGHTS_MASK)/32u;}
fn factorBitOf(rank:u32)->u32{return 1u<<((rank&FACTOR_LIGHTS_MASK)%32u);}
`,
)

export const SHADOW_MASK_BINDINGS = {
  tables: 1,
  context: 2,
  depth: 3,
  normal: 4,
  tileLights: 5,
  masks: 6,
  lights: 7,
  lightFunction: 8,
  cloudBlock: 9,
  cloudMap0: 10,
  cloudMap1: 11,
  cloudSampler: 12,
  factors: 13,
  traces: 14,
  lightTiles: 15,
} as const

const B = SHADOW_MASK_BINDINGS

/** Where the mask's program reads the light functions, and the eye their fade is measured from. */
const SHADOW_MASK_LIGHT_FUNCTION: LightFunctionBindings = {
  group: 0,
  atlas: B.lightFunction,
  eye: 'lp.eye.xyz',
}

/** Where the mask's program reads the clouds' shade. */
export const SHADOW_MASK_CLOUD_SHADOW: CloudShadowBindings = {
  group: 0,
  block: B.cloudBlock,
  map0: B.cloudMap0,
  map1: B.cloudMap1,
  sampler: B.cloudSampler,
}

export const SHADOW_MASK_ENTRY = 'shadowMask'

export const SHADOW_MASK_PROGRAM_WGSL = wgslProgram(
  `${wgslConsts({ PAGE_TEMPORAL: PAGE_LIGHTING.temporal, QUADS: SHADOW_MASK.quads, QUAD_ROW: CARD_TILE_SIZE / 2 })}
@group(0) @binding(${B.tileLights}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${B.masks}) var<storage,read_write> masks:array<u32>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.factors}) var<storage,read> factors:array<u32>;
@group(0) @binding(${B.traces}) var<storage,read_write> traces:array<atomic<u32>>;
@group(0) @binding(${B.lightTiles}) var<storage,read_write> lightTiles:array<u32>;
var<workgroup> sharedMask:array<atomic<u32>,SHADOW_MASK_TILE_WORDS>;
var<workgroup> quadWrites:array<atomic<u32>,QUADS>;
var<workgroup> sharedTraces:array<u32,${SHADOW_TEXELS}>;
var<workgroup> traceCount:atomic<u32>;
var<workgroup> traceBase:u32;
/** The ray of light \`rank\` at the texel: nothing of it where no light reaches the texel, else its function and the clouds' shade. */
fn lightAttenuation(rank:u32,texel:SurfaceTexel)->ShadowRay{
 var ray=ShadowRay(0.0,true);
 if(!texel.valid){return ray;}
 let light=directLights.items[rank];
 let P=texel.position/CM_PER_M;
 if(!any(declaredBareIrradiance(rank,P,texel.normal,0.0)>vec3f(0.0))){return ray;}
 ray=ShadowRay(1.0,false);
 if(hasLightFunction(light.params.x)){
  let given=lightFunctionOf(light.params.x,P);
  ray.factor*=(given.x+given.y+given.z)/3.0;
  ray.complete=!isVisibleToLight(ray.factor);
 }
 if(!ray.complete){
  ray.factor*=cloudShadowOnSurface(rank,P);
  ray.complete=!isVisibleToLight(ray.factor);
 }
 if(!castsShadow(light)){ray.complete=true;}
 return ray;
}
@compute @workgroup_size(8,8,1)
fn ${SHADOW_MASK_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let first=tile*(lp.maxLights+1u);
 // The tile's count is the same for the whole workgroup: the walk of its lights holds the barriers.
 let lights=tileLights[first];
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 let texel=surfaceTexel(page,coord*LG_TILE+at.xy);
 let bit=shadowBit(at.xy);
 let quad=(at.y/2u)*QUAD_ROW+at.x/2u;
 let picked=((at.y&1u)*2u+(at.x&1u))==scPageW(page,PAGE_TEMPORAL)%4u;
 for(var k=0u;k<lights;k++){
  let rank=tileLights[first+1u+k];
  let lightTile=tile*lp.maxLights+k;
  // The tile saw this light uniformly at its last update: its texels may trace one in four.
  let steady=lgFlag(FLAG_ADAPTIVE_SHADOWS)&&(factors[cardTileFactorWord(page,coord)+factorWordOf(rank)]&factorBitOf(rank))!=0u;
  if(lane<SHADOW_MASK_TILE_WORDS){atomicStore(&sharedMask[lane],0u);}
  if(lane<QUADS){atomicStore(&quadWrites[lane],1u);}
  if(lane==0u){atomicStore(&traceCount,0u);}
  workgroupBarrier();
  let ray=lightAttenuation(rank,texel);
  let byte=shadowByteOf(ray);
  if(byte!=0u){atomicOr(&sharedMask[bit/32u],byte<<(bit%32u));}
  var write=!ray.complete;
  if(steady&&!write){atomicStore(&quadWrites[quad],0u);}
  workgroupBarrier();
  var downsample=0u;
  if(steady&&atomicLoad(&quadWrites[quad])!=0u){
   downsample=1u;
   write=picked;
  }
  if(write){
   let slot=atomicAdd(&traceCount,1u);
   sharedTraces[slot]=packShadowTrace(lightTile,at.xy,downsample);
  }
  // The mask is read before the barrier that lets the next light reset it.
  var maskWord=0u;
  if(lane<SHADOW_MASK_TILE_WORDS){maskWord=atomicLoad(&sharedMask[lane]);}
  workgroupBarrier();
  let count=atomicLoad(&traceCount);
  if(lane==0u&&count>0u){traceBase=atomicAdd(&traces[0],count);}
  workgroupBarrier();
  if(lane<count){atomicStore(&traces[1u+traceBase+lane],sharedTraces[lane]);}
  if(lane<SHADOW_MASK_TILE_WORDS){masks[lightTile*SHADOW_MASK_TILE_WORDS+lane]=maskWord;}
  if(lane==0u){
   lightTiles[lightTile*SHADOW_LIGHT_TILE_WORDS]=packed;
   lightTiles[lightTile*SHADOW_LIGHT_TILE_WORDS+1u]=rank;
  }
 }
}`,
  [
    lightingCommonWgsl({ tables: B.tables, context: { binding: B.context, access: 'read' } }),
    surfaceTexelWgsl(lightingLayersWgsl(B.depth, B.normal)),
    SHADOW_MASK_WGSL,
    CM_PER_M_WGSL,
    DIRECT_LIGHT_WGSL,
    hasLightFunctionWgsl,
    lightFunctionReadWgsl(SHADOW_MASK_LIGHT_FUNCTION),
    cloudShadowReadWgsl(SHADOW_MASK_CLOUD_SHADOW),
    declaredLightWgsl({}, { term: 'bareIrradiance' }),
  ],
)
