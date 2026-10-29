import { ATMOSPHERE_SLOT } from '../../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { CARD_TILE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import type { CloudShadowBindings } from '../../atmosphere/cloudShadowRead.ts'
import { cloudShadowReadWgsl } from '../../atmosphere/cloudShadowRead.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { declaredLightWgsl } from '../../direct/lightLoopWgsl.ts'
import { lightProfileOfWgsl } from '../../lightProfile/lightProfileWgsl.ts'
import { type LightProfileBindings } from '../../lightProfile/lightProfileText.ts'
import { rectBindingsOf, rectSourceWgsl } from '../../rectLightAtlas/readWgsl.ts'
import { lightStrengthWgsl } from '../../direct/lightStrengthWgsl.ts'
import {
  hasLightFunctionWgsl,
  lightFunctionReadWgsl,
  type LightFunctionBindings,
} from '../../lightFunction/readWgsl.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import {
  CM_PER_M_WGSL,
  lightingCommonWgsl,
  VIEW_EXPOSURE,
  lightingLayersWgsl,
  surfaceTexelWgsl,
} from './commonWgsl.ts'
import { lightTileCountsWgsl } from './lightTilesWgsl.ts'
import {
  PAGE_LIGHTING,
  SHADOW_FACTOR_TILE_WORDS,
  SHADOW_QUADS,
  SHADOW_TEXELS,
  SHADOW_TRACE,
  shadowMaskOf,
} from './layout.ts'

/**
 * THE SHADOW MASK OF A LIGHT ON A TILE, and what the shadow traces and the direct light read of it (`layout.ts` says how
 * it is laid): a byte a texel of the tile's 8 × 8, the light's factor on 7 bits — the share of the light the texel
 * receives, 127 for all of it — and, in the top bit, whether the factor is settled. With the light functions' coloured
 * atlas (`'colour'`, `lightFunctionFormat`) the texel is two bytes and the factor is a colour, 5 bits for each channel, 31 for
 * all of it, the top bit of the two bytes saying whether it is settled: a light function then tints the light, where in the
 * grey format it only dims it (the mean of its channels). A texel that no light reaches is settled
 * at 0. One that does starts at 1, unsettled; the light's function (the atlas's, then, for a light the atlas holds no slot of, its material's share at the texel, `standaloneMaskWgsl.ts`) multiplies the factor and then the clouds' shade, each
 * settling the texel when the factor falls to 0.01 or less; a light that casts no shadow settles it too. What is left
 * unsettled is a shadow trace (`shadowTraceWgsl.ts`), one word naming the light tile and the texel, which multiplies the factor by 0 or 1 and settles it.
 *
 * The masks are made over the compacted light tiles (`lightTilesWgsl.ts`), a workgroup a light tile, a thread a texel: the tile's page
 * and tile word and its light are the compacted list's, and the tile's mask is written at the place of the light tile in that list.
 * The tiles of a light whose function the atlas holds no slot of (`TILE_LIGHT_STANDALONE`) are left alone by the program above and made by
 * a program of the light's material, the same kernel with the material's share in its place (`shadowMaskProgramWith`), dispatched over the
 * light's slot alone.
 * The slots of the lights together (`shadowMaskLights`) and each of the batchable types' (`shadowMaskPoint`, `shadowMaskSpot`,
 * `shadowMaskRect`) are dispatched by their own arguments; the program is one, the light being named by the light tile. Each
 * makes the texels' masks and lists the ones left unsettled as shadow traces, packed with a count in front. Where the tile
 * was uniformly visible to the light, or uniformly shadowed, at its last update (`factors`, one bit a light, 256 lights a
 * tile of the atlas) and every texel of a quad of four is unsettled, only one of the four is listed, the one
 * the page's direct update number picks, and the trace answers the quad. The count of the traces is emptied by the context's
 * clear (`contextWgsl.ts`).
 *
 * Bindings: 0 the parameters, 1 the tables, 2 the counters of the light tiles, 3 and 4 the depth and normal layers, 5 the compacted
 * light tiles, 6 the masks, 7 the lights, 8 the light functions, 9 to 12 the clouds' shade (9 is their uniform block), 13 the factor
 * atlas, 14 the shadow traces. Seven storage buffers: the tables, the counters, the compacted light tiles, the
 * masks, the lights, the factors and the traces.
 */

/** The factor above which a texel sees its light (`IsVisibleToLight`): a texel under it is settled. */
const SHADOW_VISIBLE_ABOVE = 0.01
/** The most a colour channel of a texel's factor holds in the colour format: 5 bits. */
const SHADOW_CHANNEL_MAX = 31

/** The constants of a mask in `format`: the bits of a texel's entry, of its factor, the bit that says it is settled, and where the
 *  tile's masks and traces are packed. */
const shadowConsts = (format: AtlasFormat) => {
  const mask = shadowMaskOf(format)
  return wgslConsts({
    SHADOW_FACTOR_MAX: (1 << mask.factorBits) - 1,
    SHADOW_COMPLETE: 1 << mask.factorBits,
    SHADOW_BYTE_MASK: (1 << mask.rayBits) - 1,
    SHADOW_RAY_BITS: mask.rayBits,
    SHADOW_MASK_TILE_WORDS: mask.tileWords,
    SHADOW_LIGHT_TILE_MASK: 2 ** SHADOW_TRACE.lightTileBits - 1,
    SHADOW_X_SHIFT: SHADOW_TRACE.xShift,
    SHADOW_Y_SHIFT: SHADOW_TRACE.yShift,
    SHADOW_DOWN_SHIFT: SHADOW_TRACE.downsampleShift,
    SHADOW_COORD_MASK: SHADOW_TRACE.coordMask,
    SHADOW_QUAD_MASK: SHADOW_TRACE.quadMask,
    SHADOW_DOWN_MASK: SHADOW_TRACE.downsampleMask,
    FACTOR_LIGHTS_MASK: SHADOW_FACTOR_TILE_WORDS * 32 - 1,
  })
}

/** The factor atlas's addressing, shared by every kernel that reads or writes it: its tiles are `FACTOR_TILE_WORDS` words each. */
export const SHADOW_FACTOR_ATLAS_WGSL = wgslBlock(
  'SHADOW_FACTOR_ATLAS_WGSL',
  [],
  `${wgslConsts({ FACTOR_TILE_WORDS: SHADOW_FACTOR_TILE_WORDS })}
/** The first word of the tile \`tile\` of a factor atlas \`tilesAlong\` tiles wide. */
fn factorTileWord(tile:vec2u,tilesAlong:u32)->u32{return FACTOR_TILE_WORDS*(tile.y*tilesAlong+tile.x);}
`,
)

/** The lights that carry a factor per texel in a mask (`needsShadowMask`): those that cast a shadow, wear a light function (the atlas's
 *  or, `standalone`, apart from it), or are shaded by the clouds (one of the two lights with a map of them). A texel is gated for such a
 *  light (`facesLightCentre`): it faces the plain direction toward the light's centre, a sun's against its own, or takes no light and no
 *  ray. Any other light has no mask and lights the texel by its wrapped cosine alone. A light's profile is no reason for a mask, nor for the
 *  gate: a lit light with a mask has its profile in the mask's factor (`lightAttenuation`), any other in the direct term
 *  (`declaredIrradiance`), once a pair. */
export const LIGHT_CENTRE_FACING_WGSL = wgslBlock(
  'LIGHT_CENTRE_FACING_WGSL',
  [DIRECT_LIGHT_WGSL, hasLightFunctionWgsl],
  `
fn needsShadowMask(rank:u32,light:DirectLight,standalone:bool)->bool{
 let slots=directLights.atmosphere[${ATMOSPHERE_SLOT.lightSlots}u];
 let clouded=(slots[0]>=0.0&&u32(slots[0])==rank)||(slots[1]>=0.0&&u32(slots[1])==rank);
 return castsShadow(light)||hasLightFunction(light)||standalone||clouded;
}
fn facesLightCentre(rank:u32,light:DirectLight,P:vec3f,N:vec3f,standalone:bool)->bool{
 if(!needsShadowMask(rank,light,standalone)){return true;}
 return dot(N,select(lampReach(light,P).xyz,-light.directionCone.xyz,isSun(light)))>0.0;
}`,
)

/** What differs between the formats in the mask's helpers: the type of a texel's factor and its values for none of the light and
 *  all of it, whether it is visible to its light
 *  (`IsVisibleToLight`: any channel above the threshold) or reaches the texel at all, its bits and back, and the share of a light
 *  function's colour it takes. The grey format keeps the factor a scalar, the mean of the function's channels; the colour one
 *  keeps the function's colour, each channel on 5 bits. */
const SHADOW_FORMAT_PARTS = {
  grey: {
    factor: 'f32',
    none: '0.0',
    full: '1.0',
    text: `fn isVisibleToLight(factor:f32)->bool{return isVisibleScalar(factor);}
fn shadowReaches(factor:f32)->bool{return factor>0.0;}
fn shadowFactorBits(factor:f32)->u32{return u32(saturate(factor)*f32(SHADOW_FACTOR_MAX));}
fn shadowFactorOfBits(bits:u32)->f32{return f32(bits&SHADOW_FACTOR_MAX)/f32(SHADOW_FACTOR_MAX);}
fn lightFunctionShade(given:vec3f)->f32{return (given.x+given.y+given.z)/3.0;}`,
  },
  colour: {
    factor: 'vec3f',
    none: 'vec3f(0.0)',
    full: 'vec3f(1.0)',
    text: `fn isVisibleToLight(factor:vec3f)->bool{return any(factor>vec3f(${SHADOW_VISIBLE_ABOVE}));}
fn shadowReaches(factor:vec3f)->bool{return any(factor>vec3f(0.0));}
fn shadowFactorBits(factor:vec3f)->u32{
 let rgb=vec3u(saturate(factor)*${SHADOW_CHANNEL_MAX}.0);
 return rgb.x|(rgb.y<<5u)|(rgb.z<<10u);
}
fn shadowFactorOfBits(bits:u32)->vec3f{
 return vec3f(f32(bits&${SHADOW_CHANNEL_MAX}u),f32((bits>>5u)&${SHADOW_CHANNEL_MAX}u),f32((bits>>10u)&${SHADOW_CHANNEL_MAX}u))/${SHADOW_CHANNEL_MAX}.0;
}
fn lightFunctionShade(given:vec3f)->vec3f{return given;}`,
  },
} as const satisfies Record<
  AtlasFormat,
  { factor: string; none: string; full: string; text: string }
>

/** The masks' and the traces' packing and the factor atlas's addressing in `format`, shared by every kernel that reads them. */
const shadowMaskBlock = (format: AtlasFormat) =>
  wgslBlock(
    `SHADOW_MASK_WGSL(${format})`,
    [SHADOW_FACTOR_ATLAS_WGSL],
    `${shadowConsts(format)}
/** A texel's factor and whether it is settled. */
struct ShadowRay{factor:${SHADOW_FORMAT_PARTS[format].factor},complete:bool}
/** Whether a scalar share of a light is visible: the threshold of a channel, for a factor that is not a colour. */
fn isVisibleScalar(factor:f32)->bool{return factor>${SHADOW_VISIBLE_ABOVE};}
${SHADOW_FORMAT_PARTS[format].text}
/** The entry of a ray: its factor truncated to the bits of the format, the top bit set where it is settled. */
fn shadowByteOf(ray:ShadowRay)->u32{return shadowFactorBits(ray.factor)|select(0u,SHADOW_COMPLETE,ray.complete);}
fn shadowRayOf(byte:u32)->ShadowRay{return ShadowRay(shadowFactorOfBits(byte),(byte&SHADOW_COMPLETE)!=0u);}
/** The bit of the texel \`coord\` of a tile in its mask's words, and the entry that starts at \`bit\` of a mask's word. */
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

/** The masks' and the traces' packing of the grey format, and of the colour one. */
const SHADOW_MASK_WGSL = shadowMaskBlock('grey')
const SHADOW_MASK_COLOURED_WGSL = shadowMaskBlock('colour')
/** The packing of the masks in \`format\`. */
export const shadowMaskBlockOf = (format: AtlasFormat) =>
  format === 'colour' ? SHADOW_MASK_COLOURED_WGSL : SHADOW_MASK_WGSL

export const SHADOW_MASK_BINDINGS = {
  tables: 1,
  counts: 2,
  depth: 3,
  normal: 4,
  lightTiles: 5,
  masks: 6,
  lights: 7,
  lightFunction: 8,
  cloudBlock: 9,
  cloudMap0: 10,
  cloudMap1: 11,
  cloudSampler: 12,
  factors: 13,
  traces: 14,
  lightProfileAtlas: 15,
  lightProfileSampler: 16,
  rectAtlas: 17,
  rectAtlasSampler: 18,
} as const

const B = SHADOW_MASK_BINDINGS

/** Where the mask's program reads the light functions, and the eye their fade is measured from. */
const SHADOW_MASK_LIGHT_FUNCTION: LightFunctionBindings = {
  group: 0,
  atlas: B.lightFunction,
  eye: 'lp.eye.xyz',
}

/** Where the mask's program reads the light profiles, and, beside them, the rectangle lights' pictures. */
export const SHADOW_MASK_LIGHT_PROFILE: LightProfileBindings = {
  group: 0,
  atlas: B.lightProfileAtlas,
  sampler: B.lightProfileSampler,
  rectAtlas: B.rectAtlas,
  rectSampler: B.rectAtlasSampler,
}

/** Where the mask's program reads the clouds' shade. */
export const SHADOW_MASK_CLOUD_SHADOW: CloudShadowBindings = {
  group: 0,
  block: B.cloudBlock,
  map0: B.cloudMap0,
  map1: B.cloudMap1,
  sampler: B.cloudSampler,
}

/** The entries of the masks: the slots of the lights together, and the point lights', the spots' and the rectangles'. */
export const SHADOW_MASK_ENTRIES = [
  'shadowMaskLights',
  'shadowMaskPoint',
  'shadowMaskSpot',
  'shadowMaskRect',
] as const

const maskDeclarations = `${wgslConsts({ PAGE_TEMPORAL: PAGE_LIGHTING.temporal, QUADS: SHADOW_QUADS, QUAD_ROW: CARD_TILE_SIZE / 2 })}
@group(0) @binding(${B.lightTiles}) var<storage,read> lightTiles:array<u32>;
@group(0) @binding(${B.masks}) var<storage,read_write> masks:array<u32>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.factors}) var<storage,read> factors:array<u32>;
@group(0) @binding(${B.traces}) var<storage,read_write> traces:array<atomic<u32>>;
var<workgroup> sharedMask:array<atomic<u32>,SHADOW_MASK_TILE_WORDS>;
var<workgroup> quadWrites:array<atomic<u32>,QUADS>;
var<workgroup> sharedTraces:array<u32,${SHADOW_TEXELS}>;
var<workgroup> traceCount:atomic<u32>;
var<workgroup> traceBase:u32;`

const maskAttenuation = (format: AtlasFormat, material: boolean) =>
  `/** The ray of light \`rank\`, \`standalone\` or not, at the texel \`origin\` of the page \`page\`: nothing of it where no light reaches the
 *  texel, else its function (the atlas's, then, for a light the atlas holds no slot of, its material's), the clouds' shade and its profile's multiplier (\`lightProfileOf\`), each settling the texel when the factor falls to 0.01 or less. */
fn lightAttenuation(rank:u32,standalone:bool,page:u32,origin:vec2u,texel:SurfaceTexel)->ShadowRay{
 var ray=ShadowRay(${SHADOW_FORMAT_PARTS[format].none},true);
 if(!texel.valid){return ray;}
 let light=directLights.items[rank];
 let P=texel.position/CM_PER_M;
 if(!any(declaredBareIrradiance(rank,P,texel.normal,0.0)>vec3f(0.0))){return ray;}
 if(!facesLightCentre(rank,light,P,texel.normal,standalone)){return ray;}
 ray=ShadowRay(${SHADOW_FORMAT_PARTS[format].full},false);
 if(hasLightFunction(light)){
  ray.factor*=lightFunctionShade(lightFunctionOf(light,P));
  ray.complete=!isVisibleToLight(ray.factor);
 }
${
  material
    ? ` if(!ray.complete&&standalone){
  ray.factor*=standaloneShare(page,origin,P);
  ray.complete=!isVisibleToLight(ray.factor);
 }
`
    : ''
} if(!ray.complete){
  ray.factor*=cloudShadowOnSurface(rank,P);
  ray.complete=!isVisibleToLight(ray.factor);
 }
 if(!ray.complete){
  ray.factor*=lightProfileOf(light,P);
  ray.complete=!isVisibleToLight(ray.factor);
 }
 if(!castsShadow(light)){ray.complete=true;}
 return ray;
}`

const maskTiles = (format: AtlasFormat, material: boolean) =>
  `/** The masks of the light tiles \`first\` up to \`end\` of the compacted list, a workgroup of the dispatch each. The tiles of a light apart from the atlas are the
 *  material's program's alone: the others leave them (\`skip\`, a value of the tile's light, the same for the whole workgroup), reaching the barriers as the rest do. */
fn shadowMaskTiles(first:u32,end:u32,group:vec3u,n:vec3u,at:vec3u,lane:u32){
 let lightTile=first+flatGroup(group,n);
 // The dispatch's rows may hold groups past its tiles: they leave together.
 if(lightTile>=end){return;}
 let packed=lightTiles[lightTile*LIGHT_TILE_WORDS];
 let listed=lightTiles[lightTile*LIGHT_TILE_WORDS+1u];
 let rank=tileLightRank(listed);
 let skip=${material ? 'false' : 'tileLightStandalone(listed)'};
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 let texel=surfaceTexel(page,coord*LG_TILE+at.xy);
 let bit=shadowBit(at.xy);
 let quad=(at.y/2u)*QUAD_ROW+at.x/2u;
 let picked=((at.y&1u)*2u+(at.x&1u))==scPageW(page,PAGE_TEMPORAL)%4u;
 // The tile saw this light uniformly at its last update: its texels may trace one in four.
 let steady=lgFlag(FLAG_ADAPTIVE_SHADOWS)&&(factors[cardTileFactorWord(page,coord)+factorWordOf(rank)]&factorBitOf(rank))!=0u;
 if(lane<SHADOW_MASK_TILE_WORDS){atomicStore(&sharedMask[lane],0u);}
 if(lane<QUADS){atomicStore(&quadWrites[lane],1u);}
 if(lane==0u){atomicStore(&traceCount,0u);}
 workgroupBarrier();
 var ray=ShadowRay(${SHADOW_FORMAT_PARTS[format].none},true);
 if(!skip){ray=lightAttenuation(rank,tileLightStandalone(listed),page,coord*LG_TILE+at.xy,texel);}
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
 // The stochastic light traces the samples it picks (\`stochasticCompact\`), not the texels the masks leave unsettled; the distance fields' pass walks the light tiles and lists none.
 if(write&&!lgFlag(FLAG_STOCHASTIC)&&!lgFlag(FLAG_FIELD_SHADOWS)){
  let slot=atomicAdd(&traceCount,1u);
  sharedTraces[slot]=packShadowTrace(lightTile,at.xy,downsample);
 }
 var maskWord=0u;
 if(lane<SHADOW_MASK_TILE_WORDS){maskWord=atomicLoad(&sharedMask[lane]);}
 workgroupBarrier();
 let count=atomicLoad(&traceCount);
 if(lane==0u&&count>0u){traceBase=atomicAdd(&traces[0],count);}
 workgroupBarrier();
 if(lane<count){atomicStore(&traces[1u+traceBase+lane],sharedTraces[lane]);}
 if(lane<SHADOW_MASK_TILE_WORDS&&!skip){masks[lightTile*SHADOW_MASK_TILE_WORDS+lane]=maskWord;}
}`

const maskEntries = () =>
  `@compute @workgroup_size(8,8,1)
fn shadowMaskLights(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tiles=perLightTiles();
 shadowMaskTiles(tiles.x,tiles.y,group,n,at,lane);
}
@compute @workgroup_size(8,8,1)
fn shadowMaskPoint(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tiles=slotTiles(${SHADOW_MASK_TYPE_SLOTS.shadowMaskPoint}u);
 shadowMaskTiles(tiles.x,tiles.y,group,n,at,lane);
}
@compute @workgroup_size(8,8,1)
fn shadowMaskSpot(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tiles=slotTiles(${SHADOW_MASK_TYPE_SLOTS.shadowMaskSpot}u);
 shadowMaskTiles(tiles.x,tiles.y,group,n,at,lane);
}
@compute @workgroup_size(8,8,1)
fn shadowMaskRect(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tiles=slotTiles(${SHADOW_MASK_TYPE_SLOTS.shadowMaskRect}u);
 shadowMaskTiles(tiles.x,tiles.y,group,n,at,lane);
}`

/** The slot of each batchable type's entry. */
export const SHADOW_MASK_TYPE_SLOTS = {
  shadowMaskPoint: 0,
  shadowMaskSpot: 1,
  shadowMaskRect: 2,
} as const

/** What every program over the light tiles' masks in `format` begins with: the lighting's common block, the tiles' counters, the surface texel, the mask and the direct light. */
export const shadowMaskCommonWgsl = (format: AtlasFormat) => [
  lightingCommonWgsl({ tables: B.tables }),
  lightTileCountsWgsl(B.counts, 'read'),
  surfaceTexelWgsl(lightingLayersWgsl(B.depth, B.normal)),
  shadowMaskBlockOf(format),
  CM_PER_M_WGSL,
  DIRECT_LIGHT_WGSL,
]

/** The entry of the program of a material: the masks of the tiles of the slot of the light its block names. */
export const SHADOW_MASK_STANDALONE_ENTRY = 'shadowMaskStandalone'

/**
 * What the mask's program is given to evaluate the light function of a light the atlas holds no slot of: the text of its material (the light's block `given`,
 * whose `light.ids.x` is the light's slot, and `standaloneShare(page, origin, P)`, the share of the light the texel at `P` receives) and what that text needs.
 */
export interface StandaloneMaskMaterial {
  readonly text: string
  readonly declarations: readonly WgslDecl[]
}

const maskStandaloneEntry = () =>
  `@compute @workgroup_size(8,8,1)
fn ${SHADOW_MASK_STANDALONE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tiles=slotTiles(LT_BATCHABLE+given.light.ids.x);
 shadowMaskTiles(tiles.x,tiles.y,group,n,at,lane);
}`

/** The mask's program in `format`: the lights' masks, or, given a `material`, the masks of the one light it belongs to. */
function shadowMaskProgramWith(format: AtlasFormat, material?: StandaloneMaskMaterial) {
  return wgslProgram(
    `${maskDeclarations}
${material ? `${material.text}\n` : ''}${maskAttenuation(format, !!material)}
${maskTiles(format, !!material)}
${material ? maskStandaloneEntry() : maskEntries()}`,
    [
      ...shadowMaskCommonWgsl(format),
      lightStrengthWgsl(VIEW_EXPOSURE),
      LIGHT_CENTRE_FACING_WGSL,
      hasLightFunctionWgsl,
      lightFunctionReadWgsl(SHADOW_MASK_LIGHT_FUNCTION),
      cloudShadowReadWgsl(SHADOW_MASK_CLOUD_SHADOW),
      lightProfileOfWgsl(SHADOW_MASK_LIGHT_PROFILE),
      rectSourceWgsl(rectBindingsOf(SHADOW_MASK_LIGHT_PROFILE)),
      declaredLightWgsl({}, { term: 'bareIrradiance' }),
      ...(material?.declarations ?? []),
    ],
  )
}

const SHADOW_MASK_PROGRAM_WGSL = shadowMaskProgramWith('grey')
const SHADOW_MASK_COLOURED_PROGRAM_WGSL = shadowMaskProgramWith('colour')

/** The mask's program in `format`. */
export const shadowMaskProgramOf = (format: AtlasFormat) =>
  format === 'colour' ? SHADOW_MASK_COLOURED_PROGRAM_WGSL : SHADOW_MASK_PROGRAM_WGSL

/** The mask's program in `format` for the light whose function is `material`. */
export const standaloneMaskProgramOf = (format: AtlasFormat, material: StandaloneMaskMaterial) =>
  shadowMaskProgramWith(format, material)
