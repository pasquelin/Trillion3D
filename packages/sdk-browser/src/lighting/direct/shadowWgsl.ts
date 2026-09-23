import { LIGHT_SETTINGS, MAX_SHADOW_SLICES, POINT_FACES } from '../../../../sdk-core/src/index.ts';
import {
  LAMP_MIPS,
  PAGE_INDEX_MASK,
  PAGE_VALID,
  POOL_SIDE,
  SHADOW_PAGE,
  SUN_LEVELS,
  lampMipOffset,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_FACTOR_WGSL } from './shadowFactorWgsl.ts';

const POISSON_16 = [
  [-0.94201624, -0.39906216],
  [0.94558609, -0.76890725],
  [-0.094184101, -0.9293887],
  [0.34495938, 0.2938776],
  [-0.91588581, 0.45771432],
  [-0.81544232, -0.87912464],
  [-0.38277543, 0.27676845],
  [0.97484398, 0.75648379],
  [0.44323325, -0.97511554],
  [0.53742981, -0.4737342],
  [-0.26496911, -0.41893023],
  [0.79197514, 0.19090188],
  [-0.2418884, 0.99706507],
  [-0.81409955, 0.9143759],
  [0.19984126, 0.78641367],
  [0.14383161, -0.1410079],
];

/** Words of the request buffer: the count, the entries the shading asked for, then one bit per
 *  table entry — a page is listed once however many pixels read it. */
export const SHADOW_REQUEST_WORDS =
  1 + LIGHT_SETTINGS.shadowRequestCap + LIGHT_SETTINGS.shadowTableEntries / 32;

/**
 * The shadow buffer as the GPU reads it: every slice's record (`SHADOW_RECORD_FLOATS`) — lamp
 * faces, the sun's frame, the window origin of each clipmap slot two by two, then the header —,
 * then the page table, one word per virtual page. One binding for both: the blend stage has no
 * storage binding to spare.
 */
const SHADOW_DATA_WGSL = `struct ShadowRecord{faces:array<mat4x4f,${POINT_FACES}>,frame:array<vec4f,3>,origins:array<vec4i,${SUN_LEVELS / 2}>,info:vec4f,}
struct ShadowData{records:array<ShadowRecord,${MAX_SHADOW_SLICES}>,table:array<u32>,}`;

/**
 * What a reading asks of the scheduler. The shading that marks writes the page into the request
 * buffer the first time any pixel reads it this frame — a bit per table entry, tested before the
 * atomic, so a page thousands of pixels read costs one list slot. A pass that does not mark —
 * the blend forward stage, which keeps its early depth reject — reads without asking.
 */
const requestWgsl = (binding: number | null) =>
  binding === null
    ? 'fn requestShadowPage(e:u32){}'
    : `@group(0) @binding(${binding}) var<storage,read_write> shadowRequests:array<atomic<u32>>;
fn requestShadowPage(e:u32){
 let word=${1 + LIGHT_SETTINGS.shadowRequestCap}u+(e>>5u);let bit=1u<<(e&31u);
 if((atomicLoad(&shadowRequests[word])&bit)!=0u){return;}
 if((atomicOr(&shadowRequests[word],bit)&bit)!=0u){return;}
 let at=atomicAdd(&shadowRequests[0],1u);
 if(at<${LIGHT_SETTINGS.shadowRequestCap}u){atomicStore(&shadowRequests[1u+at],e);}
}`;

/**
 * The virtual shadow read, shared by every pass that lights a surface: records and page table,
 * requests, the pool, and a PCF whose taps each find their own physical page.
 *
 * A map is `ShadowMap`: its first table entry, whether it is a ring — a sun level, whose pages
 * are addressed by absolute page modulo the window, `(ox, oy)` its origin — or a lamp face mip,
 * clamped at its edge, and its pages per side. Texel coordinates are relative to the map's first
 * page, texel centres at `+0.5`.
 *
 * A tap whose bilinear footprint lies in one page — every tap but those within a texel of a seam
 * — is one hardware comparison in that page. One that straddles a seam is four comparisons, each
 * texel in its own page, weighted by hand: no seam, no guard band. A texel whose page is not
 * readable is read at the nearest texel of the page that holds the point, which is.
 */
export const directShadowWgsl = (dataBinding: number, requestBinding: number | null) => `
${SHADOW_DATA_WGSL}
@group(0) @binding(${dataBinding}) var<storage,read> shadows:ShadowData;
${requestWgsl(requestBinding)}
const PCF_TAPS:u32=${LIGHT_SETTINGS.pcfTaps}u;
const SHADOW_BIAS:f32=${LIGHT_SETTINGS.shadowDepthBias};
const SHADOW_SLOPE:f32=${LIGHT_SETTINGS.shadowSlopeBias};
const SHADOW_SLOPE_MAX:f32=${LIGHT_SETTINGS.shadowSlopeBiasMax};
const SHADOW_NORMAL_TEXELS:f32=${LIGHT_SETTINGS.shadowNormalOffsetTexels};
const SHADOW_PAGE:f32=${SHADOW_PAGE}.0;
const SHADOW_POOL_SIDE:u32=${POOL_SIDE}u;
const SHADOW_ATLAS:f32=${LIGHT_SETTINGS.shadowAtlasSize}.0;
const PAGE_VALID:u32=${PAGE_VALID}u;
const PAGE_INDEX_MASK:u32=${PAGE_INDEX_MASK}u;
const LAMP_MIP_OFFSET:array<u32,${LAMP_MIPS}>=array<u32,${LAMP_MIPS}>(${Array.from({ length: LAMP_MIPS }, (_, mip) => `${lampMipOffset(mip)}u`).join(',')});
const POISSON:array<vec2f,${LIGHT_SETTINGS.pcfTaps}>=array<vec2f,${LIGHT_SETTINGS.pcfTaps}>(${POISSON_16.map(
  ([x, y]) => `vec2f(${x},${y})`,
).join(',')});
/** Pixel footprint at the lit point, in metres: set by the pass before it lights a surface. */
var<private> shadowFootprint:f32=0.0;
/** Bias in metres at the considered point: a grazing surface needs more margin than a facing
 *  one. The margin is ADDED to the reference, shadow depth being reversed like the camera's. */
fn shadowBiasMetres(cosine:f32)->f32{
 return SHADOW_BIAS+min(SHADOW_SLOPE*sqrt(1.0-cosine*cosine)/cosine,SHADOW_SLOPE_MAX);
}
struct ShadowMap{base:u32,ring:u32,pages:i32,ox:i32,oy:i32,}
fn shadowRing(v:i32,n:i32)->i32{return ((v%n)+n)%n;}
/** Word of page \`p\` of the map — asked for —, or zero when it holds nothing readable. */
fn shadowPageWord(m:ShadowMap,p:vec2i)->u32{
 var e=0;
 if(m.ring!=0u){
  if(any(p<vec2i(0))||any(p>=vec2i(m.pages))){return 0u;}
  e=i32(m.base)+shadowRing(p.y+m.oy,m.pages)*m.pages+shadowRing(p.x+m.ox,m.pages);
 }else{
  let q=clamp(p,vec2i(0),vec2i(m.pages-1));
  e=i32(m.base)+q.y*m.pages+q.x;
 }
 requestShadowPage(u32(e));
 let word=shadows.table[u32(e)];
 return select(0u,word,(word&PAGE_VALID)!=0u);
}
/** Atlas coordinate of texel coordinate \`t\` of page \`p\`, held by physical page \`word\`. */
fn shadowAtlasUv(word:u32,t:vec2f,p:vec2i)->vec2f{
 let phys=word&PAGE_INDEX_MASK;
 let origin=vec2f(f32(phys%SHADOW_POOL_SIDE),f32(phys/SHADOW_POOL_SIDE))*SHADOW_PAGE;
 return (origin+t-vec2f(p)*SHADOW_PAGE)/SHADOW_ATLAS;
}
/** Texel coordinate \`t\` moved into page \`p\`, its first and last texel centres included. */
fn shadowInPage(t:vec2f,p:vec2i)->vec2f{return clamp(t,vec2f(p)*SHADOW_PAGE+0.5,vec2f(p+1)*SHADOW_PAGE-0.5);}
fn shadowCompare(word:u32,t:vec2f,p:vec2i,reference:f32)->f32{
 return textureSampleCompareLevel(shadowAtlas,shadowSampler,shadowAtlasUv(word,t,p),reference);
}
/** One bilinear comparison at \`t\`; \`home\` is the page holding the lit point, \`homeWord\` its word. */
fn shadowTap(m:ShadowMap,t:vec2f,reference:f32,home:vec2i,homeWord:u32)->f32{
 let lo=floor(t-0.5);
 let p0=vec2i(floor(lo/SHADOW_PAGE));let p1=vec2i(floor((lo+1.0)/SHADOW_PAGE));
 if(all(p0==p1)){
  var word=homeWord;
  if(any(p0!=home)){word=shadowPageWord(m,p0);}
  if(word==0u){return shadowCompare(homeWord,shadowInPage(t,home),home,reference);}
  return shadowCompare(word,t,p0,reference);
 }
 let f=t-0.5-lo;
 var sum=0.0;
 for(var k=0u;k<4u;k++){
  let corner=vec2f(f32(k&1u),f32(k>>1u));
  let centre=lo+corner+0.5;
  let p=vec2i(floor((lo+corner)/SHADOW_PAGE));
  var word=homeWord;
  if(any(p!=home)){word=shadowPageWord(m,p);}
  let weight=mix(1.0-f.x,f.x,corner.x)*mix(1.0-f.y,f.y,corner.y);
  if(word==0u){sum+=weight*shadowCompare(homeWord,shadowInPage(centre,home),home,reference);}
  else{sum+=weight*shadowCompare(word,centre,p,reference);}
 }
 return sum;
}
/** Sixteen taps a texel apart around \`t\`; a lamp face clamps them at its edge (\`side\` > 0). */
fn shadowPcf(m:ShadowMap,t:vec2f,reference:f32,home:vec2i,homeWord:u32,side:f32)->f32{
 var lit=0.0;
 for(var tap=0u;tap<PCF_TAPS;tap++){
  var at=t+POISSON[tap];
  if(side>0.0){at=clamp(at,vec2f(0.5),vec2f(side-0.5));}
  lit+=shadowTap(m,at,reference,home,homeWord);
 }
 return lit/f32(PCF_TAPS);
}
${SHADOW_FACTOR_WGSL}`;
