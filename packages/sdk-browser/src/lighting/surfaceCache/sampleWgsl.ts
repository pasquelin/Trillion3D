import { wgslBlock, wgslFn, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { LIGHTING_CHANNELS_WGSL } from '../lightingChannelsWgsl.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { unpackLight } from '../../gpu/core/smallFloatWgsl.ts'
import {
  lightAtlasScalar,
  lightAtlasSampleType,
  WORD_LIGHT_FORMAT,
  type LightAtlasFormat,
} from '../../gpu/core/lightAtlasFormat.ts'
import {
  MAX_RES_LEVEL,
  MIN_RES_LEVEL,
  PAGE_SIZE,
  SUB_ALLOCATION_RES_LEVEL,
} from '../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import {
  CARD_CHANNELS_SHIFT,
  CARD_WORDS,
  MESH_CARDS_WORDS,
} from '../../../../sdk-core/src/lighting/surfaceCache/cardRecords.ts'
import { CARD_PAGE_WORDS } from '../../../../sdk-core/src/lighting/surfaceCache/pageRecords.ts'
import { FEEDBACK_AT } from './feedbackLayout.ts'
import { vsmIntToColor } from '../shadows/vsm/debug/pageColorWgsl.ts'
import { PAGE_LIGHTING } from './lighting/layout.ts'
import { lightWordsOf } from '../../gpu/core/lightWords.ts'
import {
  isLayerMode,
  VISUALIZE_LAST_USED_MODES,
  VISUALIZE_MODE,
  visualizeLayersOf,
} from './visualizeModes.ts'
import { indirectWordsWgsl } from './indirectWords.ts'
import { TABLE_AT, NO_MESH_CARDS, TILE } from './layout.ts'

/**
 * THE SURFACE CACHE'S READ, as a WGSL library with no caller of its own: what a ray that hits a mesh
 * asks of the cards the mesh carries — the light of the surface at the point it hit, and which page
 * of which card it read.
 *
 * `scSampleMeshCards` takes the hit's world position and normal (in centimetres, the unit of the
 * cards) and the mesh cards of the placement it hit (`scPlacementMeshCards`, the table of the
 * placements the tables hold), carries them into the space of the mesh cards, and picks the cards of
 * the faces the normal looks at, those whose box holds the point, each weighted by how squarely the
 * normal faces it. Each card is read where the point falls on it: the page of its page table (the page
 * that holds the texels, or, where its own page is not in the atlas, the next coarser one that does:
 * `scComputeSample`), four texels bilinearly, each weighted by how near its stored depth is to the
 * point's depth — a texel behind or in front of the surface the card saw by more than `bias` carries
 * none. The cards' samples add into an accumulator (`ScAccum`); `scEvaluate` divides it, scales the
 * light by one over the pre-exposure it is kept multiplied by, and, where the host asks it
 * (`feedback`), tells the CPU which finer page the ray's cone would have read.
 *
 * `bias` is the depth test's slack and the cards' boxes' margin, in the space of the mesh cards:
 * the more a traced geometry differs from the mesh, the more it needs; a mesh mostly two-sided gets
 * fifty centimetres more, where its hits are not to be trusted. `radius` is the footprint of the
 * ray's cone, which picks the level of a page read for the feedback; `hiRes` reads the finest pages
 * of a card that are in the atlas, else the coarsest, always there.
 *
 * Bindings, consecutive from `first` in `group`: the tables (`surfaceTables`, read-only words: the
 * header, the mesh cards, the cards, the page table, the pages, the placements — `layout.ts`) and the
 * atlas's layers, sampled by load: depth, albedo, normal, emission, direct, indirect and final light, at
 * `SURFACE_CACHE_LAYER_AT`; the library reads the depth and the final light — the albedo, the normal and the emission it
 * declares for the programs that read them through it, the direct and the indirect light none: they hold the places of
 * the layout, and a program that only reads a hit leaves the layers it does not reach out of its own.
 * The albedo and the normal are float textures whether the atlas is compressed or not; the emission
 * is a float texture where it is (`compressed`: BC6H) and a texture of words of light (`packLight`)
 * where it is not, so a host passes the atlases' own `compressed` to the layout and to the library. The direct and final light are textures
 * of words or of floats as the atlases' own `light` format is (`lightAtlasFormat`), which the layout and the library are asked for alike; the indirect light is
 * always words (`indirectWords.ts`).
 * With `feedback` the binding after the layers (`SURFACE_CACHE_LAYER_AT.feedback`) is the feedback buffer, written: its first words say where
 * its parts are — the element counter, the elements (two words each), the pages' last use, and the
 * pages' last use by a read that could have used a finer page — and the feedback's own numbers: its
 * size in elements, the wrap mask of the tile of the image one pixel writes in and where in it, the
 * image the read is made at, and the level bias (a float).
 */

const CONSTANTS = wgslConsts({
  SC_PAGE_SIZE: PAGE_SIZE,
  SC_TILE: TILE,
  SC_CARD_WORDS: CARD_WORDS,
  SC_CARD_CHANNELS_SHIFT: CARD_CHANNELS_SHIFT,
  SC_MESH_CARDS_WORDS: MESH_CARDS_WORDS,
  SC_NONE: NO_MESH_CARDS,
  SC_MIN_RES_LEVEL: MIN_RES_LEVEL,
  SC_MAX_RES_LEVEL: MAX_RES_LEVEL,
  SC_SUB_ALLOCATION_RES_LEVEL: SUB_ALLOCATION_RES_LEVEL,
  SC_AT_CARDS: TABLE_AT.cards,
  SC_AT_MESH_CARDS: TABLE_AT.meshCards,
  SC_AT_PLACEMENTS: TABLE_AT.placements,
  SC_AT_ATLAS_SIDE: TABLE_AT.atlasSide,
  SC_AT_INV_ATLAS_SIDE: TABLE_AT.invAtlasSide,
  SC_AT_MESH_CARDS_AT: TABLE_AT.meshCardsAt,
  SC_AT_CARDS_AT: TABLE_AT.cardsAt,
  SC_AT_PAGE_TABLE_AT: TABLE_AT.pageTableAt,
  SC_AT_CARD_PAGES_AT: TABLE_AT.cardPagesAt,
  SC_CARD_PAGE_WORDS: CARD_PAGE_WORDS,
  SC_AT_PLACEMENTS_AT: TABLE_AT.placementsAt,
  SC_AT_FRAME: TABLE_AT.frame,
  SC_AT_INV_PRE_EXPOSURE: TABLE_AT.invPreExposure,
  SC_AT_COLOR_BOOST: TABLE_AT.colorBoost,
})

/** What a program reads the cache with: whether it also writes the feedback buffer, whether the atlas
 *  it reads is compressed (`SurfaceAtlases.compressed`) and the format of its direct and final light (`SurfaceAtlases.light`) — all named, so that a
 *  stale call is a type error. */
export interface SurfaceCacheRead {
  readonly feedback: boolean
  readonly compressed: boolean
  readonly light: LightAtlasFormat
  /** Whether a read gathers the surface (`scEvaluateMaterialCards`: its albedo, emission and normal) in place of its final light: the final layer is then no binding of the program. */
  readonly material?: boolean
  /** The mode of the scene view the read is made for (`visualizeModes.ts`): a layer mode shows the layer it names (`visualizeLayersOf`) in place of the final light, which is then no binding of the program; the coverage mode marks the points the mesh cards were met at. */
  readonly visualize?: number
}

/** Where the read library binds each atlas layer, and the feedback buffer, past the tables' binding. */
export const SURFACE_CACHE_LAYER_AT = {
  depth: 1,
  albedo: 2,
  normal: 3,
  emissive: 4,
  direct: 5,
  indirect: 6,
  final: 7,
  feedback: 8,
  frames: 9,
  factors: 10,
} as const

const L = SURFACE_CACHE_LAYER_AT

/** The layout entries of the tables and the atlas layers' bindings from `first`, and the feedback
 *  buffer's after them when `read.feedback`. */
export function surfaceCacheReadLayoutEntries(
  first: number,
  read: SurfaceCacheRead,
): GPUBindGroupLayoutEntry[] {
  return [
    computeBufferEntry(first, 'read-only-storage'),
    computeTextureEntry(first + L.depth, 'uint'),
    computeTextureEntry(first + L.albedo, 'float'),
    computeTextureEntry(first + L.normal, 'float'),
    computeTextureEntry(first + L.emissive, read.compressed ? 'float' : 'uint'),
    computeTextureEntry(first + L.direct, lightAtlasSampleType(read.light)),
    computeTextureEntry(first + L.indirect, 'uint'),
    computeTextureEntry(first + L.final, lightAtlasSampleType(read.light)),
    ...(read.feedback ? [computeBufferEntry(first + L.feedback, 'storage')] : []),
    ...(read.visualize
      ? [
          computeTextureEntry(first + L.frames, 'uint'),
          computeBufferEntry(first + L.factors, 'read-only-storage'),
        ]
      : []),
  ]
}

/** The tables' binding, read — or, for the pass that writes the pages' lighting state, read and written. */
const recordTables = (group: number, first: number, access: 'read' | 'read_write') =>
  `@group(${group}) @binding(${first}) var<storage,${access}> surfaceTables:array<u32>;\n`

/** The atlas layers' bindings' declarations (and the feedback buffer's). */
const readBindings = (
  group: number,
  first: number,
  { feedback, compressed, light, material, visualize }: SurfaceCacheRead,
) =>
  `@group(${group}) @binding(${first + L.depth}) var scDepthAtlas:texture_2d<u32>;
@group(${group}) @binding(${first + L.albedo}) var scAlbedoAtlas:texture_2d<f32>;
@group(${group}) @binding(${first + L.normal}) var scNormalAtlas:texture_2d<f32>;
@group(${group}) @binding(${first + L.emissive}) var scEmissiveAtlas:texture_2d<${compressed ? 'f32' : 'u32'}>;
${material || isLayerMode(visualize) ? '' : `@group(${group}) @binding(${first + L.final}) var scFinalAtlas:texture_2d<${lightAtlasScalar(light)}>;\n`}${feedback ? `@group(${group}) @binding(${first + L.feedback}) var<storage,read_write> scFeedback:array<atomic<u32>>;\n` : ''}${visualizeBindings(group, first, light, visualize)}`

/** The declarations of the layers the scene view's mode `mode` reads beside the albedo, normal and emission: the direct light, the indirect light's words, the radiosity's frames, the shadow factors. */
const visualizeBindings = (
  group: number,
  first: number,
  light: LightAtlasFormat,
  mode?: number,
) => {
  if (mode === undefined) return ''
  const has = (layer: string) => visualizeLayersOf(mode).includes(layer as never)
  return `${mode === VISUALIZE_MODE.surfaceCache ? 'var<private> scSeenMeshCards:bool;\n' : ''}${has('direct') ? `@group(${group}) @binding(${first + L.direct}) var scDirectAtlas:texture_2d<${lightAtlasScalar(light)}>;\n` : ''}${has('indirect') ? `@group(${group}) @binding(${first + L.indirect}) var scIndirectAtlas:texture_2d<u32>;\n` : ''}${has('frames') ? `@group(${group}) @binding(${first + L.frames}) var scFramesAtlas:texture_2d<u32>;\n` : ''}${has('factors') ? `@group(${group}) @binding(${first + L.factors}) var<storage,read> scFactors:array<u32>;\n` : ''}`
}

/** A word of the tables, as it is stored and as a float: for a program that declares `surfaceTables`. */
export const SURFACE_TABLE_WORDS_WGSL = wgslBlock(
  'SURFACE_TABLE_WORDS_WGSL',
  [],
  `fn scW(i:u32)->u32{return surfaceTables[i];}
fn scF(i:u32)->f32{return bitcast<f32>(surfaceTables[i]);}`,
)

/** The records: a card, a mesh cards, and what takes a vector from the space of the mesh cards to a
 *  card's. */
const RECORD_READS = `
fn scAtlasSide()->f32{return f32(surfaceTables[SC_AT_ATLAS_SIDE]);}
fn scInvAtlasSide()->f32{return scF(SC_AT_INV_ATLAS_SIDE);}
/** The mesh cards of the placement \`placement\`, SC_NONE where it has none. */
fn scPlacementMeshCards(placement:u32)->u32{
 if(placement>=scW(SC_AT_PLACEMENTS)){return SC_NONE;}
 return scW(scW(SC_AT_PLACEMENTS_AT)+placement);
}
struct ScCard{
 flags:u32,direction:u32,visible:bool,channels:u32,resBias:vec2u,
 origin:vec3f,axisX:vec3f,axisY:vec3f,axisZ:vec3f,
 size:vec2u,first:u32,hiSize:vec2u,hiFirst:u32,
 meshCentre:vec3f,meshHalf:vec3f,axesWord:u32,extent:vec3f,
}
/** The pages along each axis of a mip whose axes are at \`levels\`. */
fn scPagesOf(levels:vec2u)->vec2u{
 return select(vec2u(1u),vec2u(1u)<<(max(levels,vec2u(SC_SUB_ALLOCATION_RES_LEVEL))-vec2u(SC_SUB_ALLOCATION_RES_LEVEL)),levels>vec2u(SC_SUB_ALLOCATION_RES_LEVEL));
}
fn scCard(index:u32)->ScCard{
 let b=scW(SC_AT_CARDS_AT)+index*SC_CARD_WORDS;
 var c:ScCard;
 c.flags=scW(b+3u);
 c.resBias=vec2u(c.flags&255u,(c.flags>>8u)&255u);
 c.direction=(c.flags>>16u)&15u;
 c.visible=((c.flags>>24u)&1u)!=0u;
 c.channels=storedToChannels(c.flags>>SC_CARD_CHANNELS_SHIFT);
 c.origin=vec3f(scF(b)+scF(b+7u),scF(b+1u)+scF(b+11u),scF(b+2u)+scF(b+15u));
 c.axisX=vec3f(scF(b+4u),scF(b+5u),scF(b+6u));
 c.axisY=vec3f(scF(b+8u),scF(b+9u),scF(b+10u));
 c.axisZ=vec3f(scF(b+12u),scF(b+13u),scF(b+14u));
 let coarse=scW(b+16u);let fine=scW(b+18u);
 c.size=vec2u(coarse&0xffffu,coarse>>16u);c.first=scW(b+17u);
 c.hiSize=vec2u(fine&0xffffu,fine>>16u);c.hiFirst=scW(b+19u);
 c.meshCentre=vec3f(scF(b+20u),scF(b+21u),scF(b+22u));
 c.axesWord=scW(b+23u);
 c.meshHalf=vec3f(scF(b+24u),scF(b+25u),scF(b+26u));
 // The half sides along the card's own axes: each object axis's goes to the card axis lying along it.
 var e=vec3f(0.0);
 for(var a=0u;a<3u;a++){e[((c.axesWord>>(3u*a))&7u)>>1u]=c.meshHalf[a];}
 c.extent=vec3f(e.x,e.y,max(e.z,1.0));
 return c;
}
/** A vector of the space of the mesh cards in the card's: each object axis goes to the card axis it
 *  lies along, with its sign. */
fn scRotateToCard(v:vec3f,word:u32)->vec3f{
 var o=vec3f(0.0);
 for(var a=0u;a<3u;a++){
  let bits=(word>>(3u*a))&7u;
  o[bits>>1u]=select(-v[a],v[a],(bits&1u)!=0u);
 }
 return o;
}
struct ScMeshCards{origin:vec3f,rows:mat3x3f,first:u32,count:u32,twoSided:bool,lookup:array<u32,6>}
fn scMeshCards(index:u32)->ScMeshCards{
 let b=scW(SC_AT_MESH_CARDS_AT)+index*SC_MESH_CARDS_WORDS;
 var m:ScMeshCards;
 m.origin=vec3f(scF(b)+scF(b+7u),scF(b+1u)+scF(b+11u),scF(b+2u)+scF(b+15u));
 m.rows=mat3x3f(vec3f(scF(b+4u),scF(b+5u),scF(b+6u)),vec3f(scF(b+8u),scF(b+9u),scF(b+10u)),vec3f(scF(b+12u),scF(b+13u),scF(b+14u)));
 m.first=scW(b+16u);
 let counts=scW(b+17u);
 m.count=counts&0xffffu;
 m.twoSided=(counts&0x20000u)!=0u;
 for(var d=0u;d<6u;d++){m.lookup[d]=scW(b+18u+d);}
 return m;
}
/** The card's coordinates \`uv\` of a position \`local\` on its face (card space), in [0, 1]. */
fn scCardUv(extent:vec3f,local:vec2f)->vec2f{return saturate(vec2f(0.5,-0.5)*(local/extent.xy)+vec2f(0.5));}
/** The position in card space of the card's coordinates \`uv\` at depth \`depth\` of its box. */
fn scCardLocal(extent:vec3f,uv:vec2f,depth:f32)->vec3f{
 return vec3f(extent.x*(2.0*uv.x-1.0),extent.y*(1.0-2.0*uv.y),-(2.0*depth-1.0)*extent.z);
}
fn scCardWorld(card:ScCard,uv:vec2f,depth:f32)->vec3f{
 let l=scCardLocal(card.extent,uv,depth);
 return card.origin+card.axisX*l.x+card.axisY*l.y+card.axisZ*l.z;
}
`

/** The reads of the atlas's layers: four texels, in the order of a gather, each layer. */
const atlasReads = (compressed: boolean, light: LightAtlasFormat) => `
fn scClampTexel(p:vec2i)->vec2i{let s=i32(scAtlasSide());return clamp(p,vec2i(0),vec2i(s-1));}
/** The top left texel of the gather of the point \`uv\` of the atlas: the texel the bilinear weights of a sample
 *  (\`ScSample.weights\`) start from, the same sub-texel bias taken, so that a point a hair under a texel's centre
 *  reads that texel, never the one before it with no weight. */
fn scGatherBase(uv:vec2f)->vec2i{return vec2i(floor(uv*scAtlasSide()-vec2f(0.5-1.0/512.0)));}
fn scDepthWord(p:vec2i)->f32{return f32(textureLoad(scDepthAtlas,scClampTexel(p),0).x&0xffffu)/65535.0;}
/** The depths of the four texels of the gather at \`b\`, and whether each holds a surface. */
fn scDepths4(b:vec2i)->vec4f{return vec4f(scDepthWord(b+vec2i(0,1)),scDepthWord(b+vec2i(1,1)),scDepthWord(b+vec2i(1,0)),scDepthWord(b));}
/** The albedo the atlas holds as stored (the square root), weighted over the four texels. */
fn scAlbedo4(b:vec2i,w:vec4f)->vec3f{
 return textureLoad(scAlbedoAtlas,scClampTexel(b+vec2i(0,1)),0).xyz*w.x+textureLoad(scAlbedoAtlas,scClampTexel(b+vec2i(1,1)),0).xyz*w.y
  +textureLoad(scAlbedoAtlas,scClampTexel(b+vec2i(1,0)),0).xyz*w.z+textureLoad(scAlbedoAtlas,scClampTexel(b),0).xyz*w.w;
}
fn scNormal4(b:vec2i,w:vec4f)->vec2f{
 return textureLoad(scNormalAtlas,scClampTexel(b+vec2i(0,1)),0).xy*w.x+textureLoad(scNormalAtlas,scClampTexel(b+vec2i(1,1)),0).xy*w.y
  +textureLoad(scNormalAtlas,scClampTexel(b+vec2i(1,0)),0).xy*w.z+textureLoad(scNormalAtlas,scClampTexel(b),0).xy*w.w;
}
/** A layer of light, weighted over the four texels. */
fn scLight4(tex:texture_2d<u32>,b:vec2i,w:vec4f)->vec3f{
 return unpackLight(textureLoad(tex,scClampTexel(b+vec2i(0,1)),0).x)*w.x+unpackLight(textureLoad(tex,scClampTexel(b+vec2i(1,1)),0).x)*w.y
  +unpackLight(textureLoad(tex,scClampTexel(b+vec2i(1,0)),0).x)*w.z+unpackLight(textureLoad(tex,scClampTexel(b),0).x)*w.w;
}
${
  light === WORD_LIGHT_FORMAT
    ? ''
    : `/** A layer of light stored in floats, weighted over the four texels. */
fn scLightFloats4(tex:texture_2d<f32>,b:vec2i,w:vec4f)->vec3f{
 return textureLoad(tex,scClampTexel(b+vec2i(0,1)),0).xyz*w.x+textureLoad(tex,scClampTexel(b+vec2i(1,1)),0).xyz*w.y
  +textureLoad(tex,scClampTexel(b+vec2i(1,0)),0).xyz*w.z+textureLoad(tex,scClampTexel(b),0).xyz*w.w;
}
`
}/** The emission, weighted over the four texels: a float texture's where the atlas is compressed, else a
 *  layer of light's. */
fn scEmissive4(b:vec2i,w:vec4f)->vec3f{
${
  compressed
    ? ` return textureLoad(scEmissiveAtlas,scClampTexel(b+vec2i(0,1)),0).xyz*w.x+textureLoad(scEmissiveAtlas,scClampTexel(b+vec2i(1,1)),0).xyz*w.y
  +textureLoad(scEmissiveAtlas,scClampTexel(b+vec2i(1,0)),0).xyz*w.z+textureLoad(scEmissiveAtlas,scClampTexel(b),0).xyz*w.w;`
    : ' return scLight4(scEmissiveAtlas,b,w);'
}
}
`

/** The card-space normal of the texel the cache stores \`xy\` of: its depth component recovered. */
export const CARD_NORMAL_WGSL = wgslFn(
  'scDecodeCardNormal',
  [],
  `fn scDecodeCardNormal(encoded:vec2f)->vec3f{
 let xy=encoded*2.0-vec2f(1.0);
 return vec3f(xy,sqrt(max(1.0-dot(xy,xy),0.0001)));
}`,
)

/** What the cache stores decoded, and the records of the pages' state: the albedo, the card-space normal,
 *  and a word of the record of a page of the page table (`CARD_PAGE_WORDS`: its card, its size in texels, its
 *  rectangle of the card and of the atlas, then the lighting's own state). */
const RECORD_DECODES = `
/** The albedo of the cache from what it stores: squared, then boosted where the boost asks it: a
 *  boost under one raises the luminance, never to one, whatever the multi-bounce. */
fn scDecodeAlbedo(encoded:vec3f)->vec3f{
 var a=encoded*encoded;
 let boost=scF(SC_AT_COLOR_BOOST);
 if(boost<1.0){
  let lum=luminance(a);
  let lifted=pow(lum,boost);
  a=min(saturate(a*(lifted/max(lum,1e-8))),vec3f(0.99));
 }
 return a;
}
fn scDecodeNormal(card:ScCard,encoded:vec2f)->vec3f{
 let n=scDecodeCardNormal(encoded);
 return normalize(card.axisX*n.x+card.axisY*n.y+card.axisZ*n.z);
}
fn scPageAt(page:u32)->u32{return scW(SC_AT_CARD_PAGES_AT)+page*SC_CARD_PAGE_WORDS;}
fn scPageW(page:u32,k:u32)->u32{return scW(scPageAt(page)+k);}
fn scPageF(page:u32,k:u32)->f32{return scF(scPageAt(page)+k);}
`

/** The records over the tables bound at `first` of `group`: the cards, the mesh cards, the pages and what the
 *  cache stores decoded (`RECORD_DECODES`): a program that lights the pages binds them without the atlas's layers. */
export const surfaceCacheRecordsWgsl = (
  group: number,
  first: number,
  access: 'read' | 'read_write' = 'read',
): WgslDecl =>
  wgslBlock(
    `SURFACE_CACHE_RECORDS_WGSL(${group},${first},${access})`,
    [luminance, CARD_NORMAL_WGSL, LIGHTING_CHANNELS_WGSL, SURFACE_TABLE_WORDS_WGSL],
    `${CONSTANTS}\n${recordTables(group, first, access)}${RECORD_READS}${RECORD_DECODES}`,
  )

/** The sample of a card at a point of its face (`scComputeSample`) and the accumulator the cards' samples
 *  add into. */
const sampleReads = (feedback: boolean, material: boolean) => `
struct ScSample{card:u32,page:u32,uv:vec2f,weights:vec4f,valid:bool,feedback:vec2u}
/**
 * Where the point \`local\` of card \`card\`'s face reads the atlas: the page its card coordinates fall
 * in at the coarsest level, or, \`hiRes\`, the finest; the page table says the page that holds the
 * texels — its own where it is in the atlas, else the next coarser's, at the coarser level's
 * resolution — and where. The page's edges that are not the card's are pulled in by half a texel, so
 * that a bilinear read never reaches a neighbour's, and the card's by half a texel and a sub-texel
 * margin. The four weights are the bilinear ones, in the order of a gather.
 */
fn scComputeSample(card:ScCard,index:u32,local:vec2f,radius:f32,hiRes:bool)->ScSample{
 let cardUv=min(scCardUv(card.extent,local),vec2f(0.999999));
 var sizeInPages=card.size;var tableOffset=card.first;
 if(hiRes){sizeInPages=card.hiSize;tableOffset=card.hiFirst;}
 var pageCoord=vec2u(cardUv*vec2f(sizeInPages));
 let entry=scW(SC_AT_PAGE_TABLE_AT)+2u*(tableOffset+pageCoord.x+pageCoord.y*sizeInPages.x);
 let value=vec2u(scW(entry),scW(entry+1u));
 let bias=vec2u((value.x&0xfffu)*SC_TILE,((value.x>>12u)&0xfffu)*SC_TILE);
 let levels=vec2u((value.x>>24u)&15u,(value.x>>28u)&15u);
 // The sampled page may be of another level: its size in pages and the card's place in it follow it.
 sizeInPages=scPagesOf(levels);
 pageCoord=vec2u(cardUv*vec2f(sizeInPages));
 let scale=vec2f(select(vec2u(1u)<<levels,vec2u(SC_PAGE_SIZE),levels>vec2u(SC_SUB_ALLOCATION_RES_LEVEL)));
 let pageUv=fract(cardUv*vec2f(sizeInPages));
 let minBorder=select(vec2f(0.5),vec2f(0.0),pageCoord==vec2u(0u));
 let maxBorder=select(vec2f(0.5),vec2f(0.0),pageCoord+vec2u(1u)==sizeInPages);
 let subTexel=1.0/512.0;
 let inPage=clamp(pageUv*(scale-minBorder-maxBorder)+minBorder,vec2f(0.5),scale-vec2f(0.5+subTexel));
 let atlasUv=(inPage+vec2f(bias))*scInvAtlasSide();
 let f=fract(atlasUv*scAtlasSide()+vec2f(0.5+subTexel));
 var s:ScSample;
 s.card=index;s.page=value.y;s.uv=atlasUv;
 s.weights=vec4f((1.0-f.x)*f.y,f.x*f.y,f.x*(1.0-f.y),(1.0-f.x)*(1.0-f.y));
 s.valid=levels.x>0u;
 s.feedback=vec2u(0u);
${
  feedback
    ? ` // The level the cone of the ray asks for, and the page of it the point falls in.
 let resolution=max(card.extent.x,card.extent.y)/max(radius,1.0);
 let desired=u32(clamp(log2(resolution)+bitcast<f32>(atomicLoad(&scFeedback[${FEEDBACK_AT.resLevelBias}])),f32(SC_MIN_RES_LEVEL),f32(SC_MAX_RES_LEVEL)));
 let levelSize=scPagesOf(vec2u(desired)-card.resBias);
 let localPage=vec2u(cardUv*vec2f(levelSize));
 s.feedback=vec2u(index|(desired<<24u),localPage.x+(localPage.y<<8u));
`
    : ''
} return s;
}
struct ScAccum{
 best:ScSample,validMeshCards:bool,maxWeight:f32,
 lit:vec3f,weightSum:f32,${material ? '\n albedo:vec3f,emissive:vec3f,normal:vec3f,' : ''}
}
fn scAccumulator()->ScAccum{
 var a:ScAccum;
 a.best.valid=false;a.validMeshCards=false;a.maxWeight=0.0;
 a.lit=vec3f(0.0);a.weightSum=0.0;${material ? '\n a.albedo=vec3f(0.0);a.emissive=vec3f(0.0);a.normal=vec3f(0.0);' : ''}
 return a;
}
`

/** The reader of a layer of light stored in `light`, weighted over four texels (`scLight4`, or `scLightFloats4` for the floats). */
export const lightReaderOf = (light: LightAtlasFormat) =>
  light === WORD_LIGHT_FORMAT ? 'scLight4' : 'scLightFloats4'

/** The tiles of the atlas (8 by 8 texels) drawn over a layer: 0 on a tile's edge, 1 inside (the line two hundredths of a tile wide). */
const VISUAL_TILE_GRID = `fn scVisualGrid(uv:vec2f)->f32{
 let g=abs(fract(uv*scAtlasSide()/8.0)*2.0-vec2f(1.0));
 return select(1.0,0.0,g.x>0.98)*select(1.0,0.0,g.y>0.98);
}
`

/** The colour of a page by the frames since its state last changed: white within the frame, red to blue over `span` frames. */
const VISUAL_AGE = `// A page's colour by the frames since its state last changed: white within the frame, red to blue over span frames.
fn scVisualAge(last:u32,span:f32)->vec3f{
 let since=scW(SC_AT_FRAME)-last;
 return select(mix(vec3f(1.0,0.0,0.0),vec3f(0.0,0.0,1.0),saturate(f32(since)/span)),vec3f(1.0),since<1u);
}
`

/** The value the layer of the scene view's mode `mode` gives for a card, as an expression over the card, its index, the sample `s`, the texel base `b`, the weights `w` and `invPre`. */
function visualValueOf(mode: number, light: LightAtlasFormat, feedback: boolean) {
  const V = VISUALIZE_MODE
  const words = lightWordsOf(light)
  switch (mode) {
    case V.directLighting:
      return `${lightReaderOf(light)}(scDirectAtlas,b,w)*invPre`
    case V.indirectLighting:
      return words === 1
        ? 'scLight4(scIndirectAtlas,b,w)*invPre'
        : `(indirectRead(scIndirectAtlas,scClampTexel(b+vec2i(0,1)))*w.x+indirectRead(scIndirectAtlas,scClampTexel(b+vec2i(1,1)))*w.y+indirectRead(scIndirectAtlas,scClampTexel(b+vec2i(1,0)))*w.z+indirectRead(scIndirectAtlas,scClampTexel(b))*w.w)*invPre`
    case V.albedo:
    case V.cardSharingId:
      return 'scDecodeAlbedo(scAlbedo4(b,w))'
    case V.normals:
      return 'scDecodeNormal(card,scNormal4(b,w))*0.5+vec3f(0.5)'
    case V.emissive:
      return 'scEmissive4(b,w)*invPre'
    case V.cardWeights:
      return 'scCardWeightsColour(index,s.uv)'
    case V.tileShadowDownsampleFactor:
      return 'scTileFactorsColour(s.uv)'
    case V.directLightingUpdates:
      return `scVisualAge(scPageW(s.page,${PAGE_LIGHTING.lastUpdate}u),8.0)`
    case V.indirectLightingUpdates:
      return `scVisualAge(scPageW(s.page,${PAGE_LIGHTING.lastUpdate + 1}u),16.0)`
    case V.lastUsedPage:
      return `scVisualAge(${feedback ? `atomicLoad(&scFeedback[atomicLoad(&scFeedback[${FEEDBACK_AT.lastUsed}u])+s.page])` : '0u'},8.0)`
    case V.lastUsedPageHighRes:
      return `scVisualAge(${feedback ? `atomicLoad(&scFeedback[atomicLoad(&scFeedback[${FEEDBACK_AT.lastUsedHiRes}u])+s.page])` : '0u'},8.0)`
    case V.radiosityNumFramesAccumulated:
      return 'vec3f(f32(textureLoad(scFramesAtlas,vec2i(s.uv*scAtlasSide()/8.0),0).x)/4.0*scVisualGrid(s.uv))'
    default:
      throw new Error(`mode ${mode} is no layer mode`)
  }
}

/** The helpers the layer of mode `mode` calls, beside the value itself. */
function visualHelpersOf(mode: number) {
  const V = VISUALIZE_MODE
  if (mode === V.cardWeights)
    return `// The card's colour from its number, darkened along a line round the middle of each tile of 8 texels.
fn scCardWeightsColour(index:u32,uv:vec2f)->vec3f{
 var colour=vec3f(f32(index%4u)/3.0,f32((index/4u)%4u)/3.0,0.0);
 colour.z=saturate(1.0-colour.x-colour.y);
 let away=abs(fract(uv*scAtlasSide()/8.0)-vec2f(0.5));
 let edge=saturate(select(vec2f(0.0),(away-vec2f(0.01))/away,away>vec2f(0.01)));
 let eased=edge*edge*(vec2f(3.0)-2.0*edge);
 return colour*mix(0.25,1.0,saturate(eased.x*eased.y));
}
`
  if (mode === V.tileShadowDownsampleFactor)
    return `${VISUAL_TILE_GRID}// The colour of the count of lights the tile tracks the shadow factor of: grey for none.
fn scTileFactorsColour(uv:vec2f)->vec3f{
 let tile=vec2u(uv*scAtlasSide()/8.0);
 let at=8u*(tile.y*(u32(scAtlasSide())/8u)+tile.x);
 var n=0u;
 for(var k=0u;k<8u;k++){n+=countOneBits(scFactors[at+k]);}
 return select(vsmIntToColor(n),vec3f(0.5),n==0u)*scVisualGrid(uv);
}
`
  if (mode === V.radiosityNumFramesAccumulated) return VISUAL_TILE_GRID
  if (
    mode === V.directLightingUpdates ||
    mode === V.indirectLightingUpdates ||
    VISUALIZE_LAST_USED_MODES.includes(mode)
  )
    return VISUAL_AGE
  return ''
}

/** The function `scVisualCard`: the layer of the scene view's mode `mode` a card gives in place of its final light (a light times `invPre`, or a debug colour). */
const visualCardText = (mode: number, light: LightAtlasFormat, feedback: boolean) =>
  `${visualHelpersOf(mode)}fn scVisualCard(card:ScCard,index:u32,s:ScSample,b:vec2i,w:vec4f,invPre:f32)->vec3f{
 return ${visualValueOf(mode, light, feedback)};
}
`

/** The sample of one card, added to the accumulator, the final light read stored in `light`. */
const sampleCardText = (light: LightAtlasFormat, material: boolean, visualize?: number) => `
/**
 * The sample of card \`cardIndex\` at the point \`meshPos\` of the space of the mesh cards, if the point is
 * in the card's box and the face is turned to the normal (\`axisWeights\`, the squares of its components
 * in that space), added to \`acc\`: each texel weighted by the depth test against the card's stored depth,
 * the bilinear weights over those that pass, the cards' sums by the normal's weight. The sample that
 * weighs most is kept, for the feedback.
 */
fn scSampleCard(meshPos:vec3f,radius:f32,bias:f32,cardIndex:u32,axisWeights:vec3f,hiRes:bool,acc:ptr<function,ScAccum>){
 if(cardIndex>=scW(SC_AT_CARDS)){return;}
 let card=scCard(cardIndex);
 if(!card.visible){return;}
 var cardPos=scRotateToCard(meshPos-card.meshCentre,card.axesWord);
 if(!all(abs(cardPos)<=card.extent+vec3f(0.5*bias))){return;}
 cardPos=vec3f(clamp(cardPos.xy,-card.extent.xy,card.extent.xy),cardPos.z);
 let s=scComputeSample(card,cardIndex,cardPos.xy,radius,hiRes);
 if(!s.valid){return;}
 var normalWeight=axisWeights.z;
 if(card.direction<2u){normalWeight=axisWeights.x;}else if(card.direction<4u){normalWeight=axisWeights.y;}
 if(!(normalWeight>0.0)){return;}
 let b=scGatherBase(s.uv);
 let depths=scDepths4(b);
 let hit=-(cardPos.z/card.extent.z)*0.5+0.5;
 let threshold=bias/card.extent.z;
 let falloff=0.25*threshold;
 var visibility=vec4f(0.0);
 for(var t=0u;t<4u;t++){
  // A texel with no surface carries no weight.
  if(depths[t]<1.0){visibility[t]=1.0-saturate((abs(hit-depths[t])-threshold)/falloff);}
 }
 var weights=s.weights*visibility;
 let sum=dot(weights,vec4f(1.0));
 let cardWeight=normalWeight*sum;
 if(!(cardWeight>0.0)){return;}
 weights=weights/sum;
 let invPre=scF(SC_AT_INV_PRE_EXPOSURE);
 ${
   material
     ? `(*acc).albedo+=scDecodeAlbedo(scAlbedo4(b,weights))*cardWeight;
 (*acc).emissive+=scEmissive4(b,weights)*invPre*cardWeight;
 (*acc).normal+=scDecodeNormal(card,scNormal4(b,weights))*cardWeight;`
     : isLayerMode(visualize)
       ? `(*acc).lit+=scVisualCard(card,cardIndex,s,b,weights,invPre)*cardWeight;`
       : `(*acc).lit+=${lightReaderOf(light)}(scFinalAtlas,b,weights)*invPre*cardWeight;`
 }
 (*acc).weightSum+=cardWeight;
 // The single sample that weighs most.
 if(cardWeight>(*acc).maxWeight){(*acc).best=s;(*acc).maxWeight=cardWeight;}
}
`

/** The cards of a mesh cards read for a point. */
const sampleMeshCardsText = (visualize?: number) => `/**
 * The cards of mesh cards \`meshCards\` read for the point \`worldPos\` (centimetres) whose surface faces
 * \`worldNormal\`, added to \`acc\`: the point and the normal carried into the space of the mesh cards;
 * the cards of the faces the normal looks at (\`lookup\`, by direction, one for each axis whose component
 * is not zero), those whose box — widened by half the bias — holds the point; each read (\`scSampleCard\`).
 */
fn scSampleMeshCards(meshCards:u32,worldPos:vec3f,worldNormal:vec3f,radius:f32,bias0:f32,hiRes:bool,acc:ptr<function,ScAccum>){
 if(meshCards>=scW(SC_AT_MESH_CARDS)){return;}
 var m=scMeshCards(meshCards);
 var bias=bias0;
 // A mesh mostly two-sided (foliage): its hits are not reliable.
 if(m.twoSided){bias+=50.0;}
 let rel=worldPos-m.origin;
 let meshPos=vec3f(dot(rel,m.rows[0]),dot(rel,m.rows[1]),dot(rel,m.rows[2]));
 let meshNormal=vec3f(dot(worldNormal,m.rows[0]),dot(worldNormal,m.rows[1]),dot(worldNormal,m.rows[2]));
 let axisWeights=meshNormal*meshNormal;
 var mask=0u;
 if(axisWeights.x>0.0){mask|=m.lookup[select(1u,0u,meshNormal.x<0.0)];}
 if(axisWeights.y>0.0){mask|=m.lookup[select(3u,2u,meshNormal.y<0.0)];}
 if(axisWeights.z>0.0){mask|=m.lookup[select(5u,4u,meshNormal.z<0.0)];}
 // The cards whose box holds the point.
 var kept=0u;
 var left=mask;
 while(left!=0u){
  let bit=firstTrailingBit(left);
  left^=1u<<bit;
  let card=scCard(m.first+bit);
  if(all(abs(meshPos-card.meshCentre)<=card.meshHalf+vec3f(0.5*bias))){kept|=1u<<bit;}
 }
 left=kept;
 while(left!=0u){
  let bit=firstTrailingBit(left);
  left^=1u<<bit;
  scSampleCard(meshPos,radius,bias,m.first+bit,axisWeights,hiRes,acc);
 }
 (*acc).validMeshCards=true;
${
  visualize === VISUALIZE_MODE.surfaceCache
    ? ' scSeenMeshCards=true;\n'
    : visualize === VISUALIZE_MODE.cardSharingId
      ? ` // The sharing of cards: a colour of the mesh cards' number, mixed over the light the cards gave (a point no card covers counts as one weight).
 if((*acc).weightSum<=0.0){(*acc).weightSum=1.0;}
 (*acc).lit=mix((*acc).lit,vsmIntToColor(meshCards)*(*acc).weightSum,0.9);
`
      : ''
}}
`

/** The feedback's write, where the program has one, and the hit the read answers with. */
const feedbackWriteWgsl = (feedback: boolean) => `struct ScHit{radiance:vec3f,valid:bool}
${
  feedback
    ? `/** Tells the CPU the page a read would have used at the cone's level: once in the tile of the image
 *  \`dither\` falls in, where its place in the tile is the image's jitter. The page's last use is the
 *  image's; only a high-resolution read appends the request, a coarse one writes the last use alone. */
fn scWriteFeedback(acc:ScAccum,dither:vec2u,hiRes:bool){
 let mask=atomicLoad(&scFeedback[${FEEDBACK_AT.wrapMask}]);
 let size=atomicLoad(&scFeedback[${FEEDBACK_AT.size}]);
 let tile=vec2u(atomicLoad(&scFeedback[${FEEDBACK_AT.jitterX}]),atomicLoad(&scFeedback[${FEEDBACK_AT.jitterY}]));
 if(any((dither&vec2u(mask))!=tile)||size==0u||!(acc.weightSum>0.1)){return;}
 let frame=atomicLoad(&scFeedback[${FEEDBACK_AT.frame}]);
 var zone=atomicLoad(&scFeedback[${FEEDBACK_AT.lastUsed}]);
 if(hiRes){
  zone=atomicLoad(&scFeedback[${FEEDBACK_AT.lastUsedHiRes}]);
  let slot=atomicAdd(&scFeedback[${FEEDBACK_AT.counter}],1u);
  if(slot<size){
   let at=atomicLoad(&scFeedback[${FEEDBACK_AT.elements}])+2u*slot;
   atomicStore(&scFeedback[at],acc.best.feedback.x);
   atomicStore(&scFeedback[at+1u],acc.best.feedback.y);
  }
 }
 atomicStore(&scFeedback[zone+acc.best.page],frame);
}
`
    : ''
}`

/** The accumulator evaluated. */
const evaluateWgsl = (feedback: boolean, material: boolean) => `/**
 * The light of the surface at the point the accumulator read: the sums over their weight, scaled to
 * the light the cards keep it multiplied by; nothing where no card gave any.${feedback ? ' The feedback is written (`scWriteFeedback`).' : ''}
 */
fn scEvaluate(acc:ScAccum,dither:vec2u,hiRes:bool)->ScHit{
 var h:ScHit;
 h.valid=acc.weightSum>0.0;
 h.radiance=vec3f(0.0);
 if(h.valid){
  h.radiance=acc.lit/acc.weightSum;
${feedback ? '  scWriteFeedback(acc,dither,hiRes);\n' : ''} }
 return h;
}
/** The light at the point \`worldPos\` the mesh cards \`meshCards\` hold: \`scSampleMeshCards\`, then \`scEvaluate\`. */
fn scEvaluateMeshCards(meshCards:u32,worldPos:vec3f,worldNormal:vec3f,radius:f32,bias:f32,hiRes:bool,dither:vec2u)->ScHit{
 var acc=scAccumulator();
 scSampleMeshCards(meshCards,worldPos,worldNormal,radius,bias,hiRes,&acc);
 return scEvaluate(acc,dither,hiRes);
}
${
  material
    ? `struct ScMaterial{albedo:vec3f,emissive:vec3f,normal:vec3f,valid:bool}
/** The surface at the point \`worldPos\` the mesh cards \`meshCards\` hold: the sums of the cards' albedo (decoded), emission (times the inverse of the
 *  pre-exposure) and normal over their weight (the normal unit, the surface's if no card gave any), \`valid\` where any card gave any. */
fn scEvaluateMaterialCards(meshCards:u32,worldPos:vec3f,worldNormal:vec3f,radius:f32,bias:f32,hiRes:bool)->ScMaterial{
 var acc=scAccumulator();
 scSampleMeshCards(meshCards,worldPos,worldNormal,radius,bias,hiRes,&acc);
 var m=ScMaterial(vec3f(0.0),vec3f(0.0),worldNormal,acc.weightSum>0.0);
 if(m.valid){
  m.albedo=acc.albedo/acc.weightSum;
  m.emissive=acc.emissive/acc.weightSum;
  let n=acc.normal/acc.weightSum;
  if(dot(n,n)>0.0){m.normal=normalize(n);}
 }
 return m;
}
`
    : ''
}`

/** The cards of a mesh cards read for a point, and the accumulator evaluated. */
const meshCardReads = (
  feedback: boolean,
  light: LightAtlasFormat,
  material: boolean,
  visualize?: number,
) =>
  (isLayerMode(visualize) ? visualCardText(visualize, light, feedback) : '') +
  sampleCardText(light, material, visualize) +
  sampleMeshCardsText(visualize) +
  feedbackWriteWgsl(feedback) +
  evaluateWgsl(feedback, material)

/**
 * The surface cache's read library for a program whose bindings are in `group` from `first`
 * (`surfaceCacheReadLayoutEntries`): with `read.feedback`, the program also writes the feedback buffer
 * at `SURFACE_CACHE_LAYER_AT.feedback`; `read.compressed` says the emission layer is a float texture.
 */
export function surfaceCacheSampleWgsl(
  group: number,
  first: number,
  read: SurfaceCacheRead,
): WgslDecl {
  const { feedback, compressed, light, material = false, visualize } = read
  return wgslBlock(
    `SURFACE_CACHE_SAMPLE_WGSL(${group},${first},${feedback},${compressed},${light}${material ? ',material' : ''}${visualize === undefined ? '' : `,visualize${visualize}`})`,
    [
      unpackLight,
      ...(visualize === VISUALIZE_MODE.cardSharingId ||
      visualize === VISUALIZE_MODE.tileShadowDownsampleFactor
        ? [vsmIntToColor]
        : []),
      ...(visualize === VISUALIZE_MODE.indirectLighting && lightWordsOf(light) > 1
        ? [indirectWordsWgsl(lightWordsOf(light) as 2 | 3)]
        : []),
      surfaceCacheRecordsWgsl(group, first, 'read'),
    ],
    `${readBindings(group, first, read)}${atlasReads(compressed, light)}${sampleReads(feedback, material)}${meshCardReads(feedback, light, material, visualize)}`,
  )
}
