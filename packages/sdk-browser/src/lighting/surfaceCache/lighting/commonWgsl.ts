import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import { LIGHTING_CONTEXTS } from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { INVALID_DEPTH_WORD, TILE } from '../layout.ts'
import { surfaceCacheRecordsWgsl } from '../sampleWgsl.ts'
import { CONTEXT_ARGS, CONTEXT_AT, LIGHTING_FLAG, LIGHTING_PARAMS } from './layout.ts'

/**
 * WHAT EVERY KERNEL OF THE SURFACE CACHE'S LIGHTING SHARES: the parameters (`lp`, binding 0 of group 0), the
 * constants of the context's header, the reads of the update context and the texels of a tile.
 *
 * The context (`ctxW`, bound at `ctx`, read, or `atomic` for the kernels that write it) holds, for each of the two
 * lists, how many tiles it lists (`ctxListed`) and the tiles themselves (`ctxTile`: the page, `tilePage`, and the tile
 * along x and y, `tileCoordOf`). A kernel that works a tile a workgroup finds it by the workgroup's flat rank
 * (`flatGroup`) in a dispatch in rows. A texel of a tile (`surfaceTexel`, `surfaceTexelWgsl`) is a texel of a page, the
 * atlas's texel it is, whether it holds a surface, and, where it does, its place in the world and its normal; the program
 * says what reads the two layers it needs, `texDepth` — the depth word — and `texNormal` — the first two components of
 * the card-space normal —, so that a program that reads the whole atlas through the read library (`sampleWgsl.ts`)
 * and one that writes one of its layers are the same text here.
 */

/** The bindings a lighting program's common text names: the tables' (`tables`, read or written) and the context's, none
 *  for a program that reads no list. */
interface CommonBindings {
  readonly tables: number
  readonly tablesAccess?: 'read' | 'read_write'
  readonly context?: { readonly binding: number; readonly access: 'read' | 'atomic' }
}

const CONSTANTS = wgslConsts({
  LG_TILE: TILE,
  LG_INVALID_DEPTH: INVALID_DEPTH_WORD,
  LG_LIST_DIRECT: LIGHTING_CONTEXTS.direct,
  LG_LIST_INDIRECT: LIGHTING_CONTEXTS.indirect,
  CTX_HISTOGRAM: CONTEXT_AT.histogram,
  CTX_MAX_BUCKET: CONTEXT_AT.maxBucket,
  CTX_ALLOCATED: CONTEXT_AT.allocated,
  CTX_LISTED: CONTEXT_AT.listed,
  CTX_RADIOSITY_TILES: CONTEXT_AT.radiosityTiles,
  CTX_ARGS: CONTEXT_AT.args,
  ARGS_DIRECT_TILES: CONTEXT_ARGS.directTiles,
  ARGS_INDIRECT_TILES: CONTEXT_ARGS.indirectTiles,
  ARGS_TRACES: CONTEXT_ARGS.traces,
  ARGS_PROBES: CONTEXT_ARGS.probes,
  ARGS_SHADOW_TRACES: CONTEXT_ARGS.shadowTraces,
  FLAG_DIRECT: LIGHTING_FLAG.direct,
  FLAG_RADIOSITY: LIGHTING_FLAG.radiosity,
  FLAG_PRIORITIZE_FRUSTUM: LIGHTING_FLAG.prioritizeFrustum,
  FLAG_FILTER: LIGHTING_FLAG.filter,
  FLAG_TEMPORAL: LIGHTING_FLAG.temporal,
  FLAG_PLANE_WEIGHTING: LIGHTING_FLAG.planeWeighting,
  FLAG_HISTORY_VALID: LIGHTING_FLAG.historyValid,
  FLAG_FREEZE_UPDATE_FRAME: LIGHTING_FLAG.freezeUpdateFrame,
  FLAG_ADAPTIVE_SHADOWS: LIGHTING_FLAG.adaptiveShadowTracing,
  FLAG_FORCE_TWO_SIDED: LIGHTING_FLAG.forceTwoSided,
  FLAG_FEEDBACK: LIGHTING_FLAG.feedback,
})

const TILES_WGSL = wgslBlock(
  'LIGHTING_TILES_WGSL',
  [],
  `
fn lgFlag(f:u32)->bool{return (lp.flags&f)!=0u;}
/** The rank of the workgroup in a dispatch in rows. */
fn flatGroup(g:vec3u,n:vec3u)->u32{return g.x+g.y*n.x;}
fn tilePage(packed:u32)->u32{return packed&0xffffffu;}
fn tileCoordOf(packed:u32)->vec2u{return vec2u((packed>>24u)&15u,(packed>>28u)&15u);}
fn ctxListed(list:u32)->u32{return ctxW(CTX_LISTED+list);}
fn ctxTile(list:u32,i:u32)->u32{return ctxW(select(lp.indirectAt,lp.directAt,list==LG_LIST_DIRECT)+i);}
/** A page's size in texels, and the atlas's texel its first is. */
fn pageSize(page:u32)->vec2u{return vec2u(u32(scPageF(page,2u)),u32(scPageF(page,3u)));}
fn pageMin(page:u32)->vec2u{
 let side=f32(lp.atlasSide);
 return vec2u(u32(round(scPageF(page,8u)*side)),u32(round(scPageF(page,9u)*side)));
}
/** The card's coordinates of the centre of the texel \`coord\` of a page. */
fn texelCardUv(page:u32,coord:vec2u)->vec2f{
 return vec2f(scPageF(page,4u),scPageF(page,5u))+vec2f(scPageF(page,12u),scPageF(page,13u))*(vec2f(coord)+vec2f(0.5));
}
`,
)

/** The common text of a lighting program over the bindings `b`, in group 0. */
export function lightingCommonWgsl(b: CommonBindings): WgslDecl {
  const ctx = b.context
  const reads = !ctx
    ? 'fn ctxW(i:u32)->u32{return 0u;}'
    : ctx.access === 'atomic'
      ? `@group(0) @binding(${ctx.binding}) var<storage,read_write> ctx:array<atomic<u32>>;
fn ctxW(i:u32)->u32{return atomicLoad(&ctx[i]);}`
      : `@group(0) @binding(${ctx.binding}) var<storage,read> ctx:array<u32>;
fn ctxW(i:u32)->u32{return ctx[i];}`
  return wgslBlock(
    `LIGHTING_COMMON_WGSL(${b.tables},${b.tablesAccess ?? 'read'},${ctx ? `${ctx.binding},${ctx.access}` : 'none'})`,
    [surfaceCacheRecordsWgsl(0, b.tables, b.tablesAccess ?? 'read'), TILES_WGSL],
    `${CONSTANTS}
${LIGHTING_PARAMS.wgsl}
@group(0) @binding(0) var<uniform> lp:LightingParams;
${reads}`,
  )
}

const SURFACE_TEXEL_WGSL = `
struct SurfaceTexel{valid:bool,card:u32,atlas:vec2u,position:vec3f,normal:vec3f}
/** The texel \`coord\` of \`page\`: where it is in the atlas, and, where it holds a surface, its place and its normal. */
fn surfaceTexel(page:u32,coord:vec2u)->SurfaceTexel{
 var t:SurfaceTexel;
 t.valid=false;
 t.card=scPageW(page,0u);
 t.atlas=pageMin(page)+coord;
 t.position=vec3f(0.0);
 t.normal=vec3f(0.0,0.0,1.0);
 if(any(coord>=pageSize(page))||(texDepth(t.atlas)&0xffffu)>=LG_INVALID_DEPTH){return t;}
 let card=scCard(t.card);
 t.valid=true;
 t.position=scCardWorld(card,texelCardUv(page,coord),f32(texDepth(t.atlas)&0xffffu)/65535.0);
 t.normal=scDecodeNormal(card,texNormal(t.atlas));
 return t;
}
`

/** The texels of a page (`surfaceTexel`), over the program's own `texDepth` and `texNormal` — what `layers` declares. */
export const surfaceTexelWgsl = (layers: WgslDecl): WgslDecl =>
  wgslBlock('LIGHTING_SURFACE_TEXEL_WGSL', [layers], SURFACE_TEXEL_WGSL)

/** What a program that owns its depth and normal layers reads them with: the textures at `depth` and `normal`. */
export const lightingLayersWgsl = (depth: number, normal: number): WgslDecl =>
  wgslBlock(
    `LIGHTING_LAYERS_WGSL(${depth},${normal})`,
    [],
    `@group(0) @binding(${depth}) var lgDepth:texture_2d<u32>;
@group(0) @binding(${normal}) var lgNormal:texture_2d<f32>;
fn texDepth(p:vec2u)->u32{return textureLoad(lgDepth,vec2i(p),0).x;}
fn texNormal(p:vec2u)->vec2f{return textureLoad(lgNormal,vec2i(p),0).xy;}`,
  )

/** The centimetres in a metre: the cards' unit is the centimetre, the light term's the metre. */
export const CM_PER_M_WGSL = wgslBlock('LIGHTING_CM_PER_M_WGSL', [], `const CM_PER_M:f32=${CM}.0;`)

/** What a program that reads the atlas through the read library reads the two layers with. */
export const READ_LIBRARY_LAYERS_WGSL = wgslBlock(
  'LIGHTING_READ_LIBRARY_LAYERS_WGSL',
  [],
  `fn texDepth(p:vec2u)->u32{return textureLoad(scDepthAtlas,vec2i(p),0).x;}
fn texNormal(p:vec2u)->vec2f{return textureLoad(scNormalAtlas,vec2i(p),0).xy;}`,
)
