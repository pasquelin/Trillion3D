import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { packLight } from '../../gpu/core/smallFloatWgsl.ts'
import { CARD_WORDS } from '../../../../sdk-core/src/lighting/surfaceCache/cardRecords.ts'
import { CARD_NORMAL_WGSL, surfaceCacheSampleWgsl } from './sampleWgsl.ts'
import { CAPTURE_PARAMS, INVALID_DEPTH_WORD, PAGE_FLAGS, TABLE_AT, TILE } from './layout.ts'

/**
 * THE KERNELS OF A CAPTURE, each over the tiles of 8 × 8 texels of the pages it works on: a
 * workgroup is one tile of one page — the tile list names it, `tile | page << 8` —, a thread one texel
 * of it, the page's entry (`PAGE_ENTRY_WORDS`) saying where it is in the capture atlas and in the atlas.
 *
 * - `resolve` makes the card's encodings of the surfaces the classes shaded (`shade.ts`): the
 *   albedo as the square root of the diffuse colour — the base colour less what is metal, with the
 *   share of the specular a fully rough surface shows added —, the card-space normal's first two
 *   components, the emission multiplied by the pre-exposure the light is kept at, the validity of the
 *   texel — a surface was drawn there — in the normal's last channel;
 * - `resample` fills a page that takes the texels of another card (or of its own finer level) instead of
 *   being drawn: each texel is read from the atlas where the card the page copies has it, bilinearly
 *   over the texels that hold a surface — a copy of a mirrored card read mirrored —, and written as the
 *   resolve writes it;
 * - `copy` writes the capture atlas's pages into the atlas: the depth as the card's — one minus
 *   the raster's, 1 for a texel with no surface —, the albedo and the normal as captured, the
 *   emission; a page that dilates (`PAGE_FLAGS.dilate`) gives a texel with no surface the mean of the
 *   texels of its page around it that have one, by one texel (`finalTexel`, the texel a page ends
 *   as). In the compressed atlas it writes the depth alone: the other three layers are blocks, which
 *   the encoders of `compressWgsl.ts` make from the same texels;
 * - `lights` gives the pages the light they start with: none, and, where the host asks it, their
 *   emission as their final light — a page captured again, not mapped anew, keeps the light it held, to which the
 *   lighting (`lighting/`) brings the new albedo and emission with the page's next update.
 *
 * The resample kernel reads the atlas through the read library, whose emission layer is a float
 * texture where the atlas is compressed: it has a program for each (`RESAMPLE_WGSL`,
 * `RESAMPLE_COMPRESSED_WGSL`), as the copy has (`COPY_WGSL`, `COPY_COMPRESSED_WGSL`).
 */

export const CAPTURE_COMMON = wgslBlock(
  'SURFACE_CACHE_CAPTURE_WGSL',
  [],
  `${CAPTURE_PARAMS.wgsl}
${wgslConsts({
  TILE_SIZE: TILE,
  FLAG_COPY: PAGE_FLAGS.copy,
  FLAG_FLIPPED: PAGE_FLAGS.flipped,
  FLAG_DILATE: PAGE_FLAGS.dilate,
  FLAG_FRESH: PAGE_FLAGS.fresh,
  CARD_WORDS,
  AT_CARDS_AT: TABLE_AT.cardsAt,
  INVALID_DEPTH: INVALID_DEPTH_WORD,
})}
@group(0) @binding(0) var<uniform> params:CaptureParams;
@group(0) @binding(1) var<storage,read> pageList:array<vec4u>;
@group(0) @binding(2) var<storage,read> tileList:array<u32>;
/** The tile \`slot\` of the list a kernel works on: its page, that page's entry and the texel of the
 *  capture atlas and of the page the texel \`lane\` of the tile is. */
struct Work{valid:bool,page:u32,rect:vec4u,info:vec4u,uv:vec4f,copy:u32,flags:u32,capture:vec2u,local:vec2u}
fn workAt(slot:u32,lane:vec2u)->Work{
 var w:Work;
 w.valid=slot<params.tiles;
 if(!w.valid){return w;}
 let packed=tileList[params.tileBase+slot];
 w.page=packed>>8u;
 let tile=vec2u(packed&15u,(packed>>4u)&15u);
 w.rect=pageList[w.page*4u];
 w.info=pageList[w.page*4u+1u];
 w.uv=bitcast<vec4f>(pageList[w.page*4u+2u]);
 w.copy=pageList[w.page*4u+3u].x;
 w.flags=w.info.w;
 w.local=tile*TILE_SIZE+lane;
 w.capture=w.rect.xy+w.local;
 return w;
}
/** The tile a workgroup works on, in a dispatch in rows, and the texel a thread is. */
fn work(group:vec3u,n:vec3u,lane:vec3u)->Work{return workAt(group.x+group.y*n.x,lane.xy);}
`,
)

const ENTRY = (name: string, body: string) => `
@compute @workgroup_size(${TILE},${TILE})
fn ${name}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let w=work(group,n,lane);
 if(!w.valid){return;}
${body}}
`

/** The kernel that makes the card's encodings of what the classes shaded. Bindings 3 to 8: the tables,
 *  the identifiers, the surfaces' colours (base and metalness, normal and roughness, emission, the thin
 *  sheets' transmission colour), the albedo, the normal and the emission written. */
export const RESOLVE_WGSL = wgslProgram(
  `@group(0) @binding(3) var<storage,read> surfaceTables:array<u32>;
@group(0) @binding(4) var capIds:texture_2d<u32>;
@group(0) @binding(5) var capColours:texture_2d_array<f32>;
@group(0) @binding(6) var outAlbedo:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(7) var outNormal:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(8) var outEmissive:texture_storage_2d<r32uint,write>;
fn tableFloat(i:u32)->f32{return bitcast<f32>(surfaceTables[i]);}
/** The first two axes of card \`card\` in the world. */
fn cardAxes(card:u32)->mat2x3f{
 let b=surfaceTables[AT_CARDS_AT]+card*CARD_WORDS;
 return mat2x3f(vec3f(tableFloat(b+4u),tableFloat(b+5u),tableFloat(b+6u)),vec3f(tableFloat(b+8u),tableFloat(b+9u),tableFloat(b+10u)));
}
${ENTRY(
  'resolvePages',
  ` let p=vec2i(w.capture);
 var albedo=vec4f(0.0);var normal=vec4f(0.0);var emissive=0u;
 if(textureLoad(capIds,p,0).x!=0u){
  let base=textureLoad(capColours,p,0,0);
  let surface=textureLoad(capColours,p,1,0);
  let emission=textureLoad(capColours,p,2,0);
  let thin=textureLoad(capColours,p,3,0);
  let color=base.xyz;let metal=base.w;
  // The diffuse colour: the base colour less its metal, plus the share of a fully rough surface's specular
  // (a dielectric's 4% reflectance, the base colour of a metal) that its diffuse shows, plus the colour a thin
  // double-sided sheet transmits (black for any other surface).
  var diffuse=color-color*metal;
  diffuse+=mix(vec3f(0.04),color,vec3f(metal))*0.45;
  diffuse+=thin.xyz;
  // The normal in the card's frame: a normal that is not a number faces the card.
  var xy=vec2f(0.0);
  if(all(abs(surface.xyz)<vec3f(1e30))){
   let axes=cardAxes(w.info.z);
   xy=vec2f(dot(surface.xyz,axes[0]),dot(surface.xyz,axes[1]));
  }
  albedo=vec4f(sqrt(max(diffuse,vec3f(0.0))),1.0);
  normal=vec4f(xy*0.5+vec2f(0.5),0.0,1.0);
  emissive=packLight(emission.xyz*params.preExposure);
 }
 textureStore(outAlbedo,p,albedo);
 textureStore(outNormal,p,normal);
 textureStore(outEmissive,p,vec4u(emissive,0u,0u,0u));
`,
)}`,
  [CAPTURE_COMMON, packLight],
)

/** The kernel that fills the pages that take another card's texels, for an atlas `compressed` or not.
 *  Bindings 3 to 10 are the read library's (`surfaceCacheSampleWgsl(0, 3, …)`: the tables and the
 *  atlas's layers), 11 to 14 the capture atlas's albedo, normal, emission and depth, written. */
const resampleWgsl = (compressed: boolean) =>
  wgslProgram(
    `@group(0) @binding(11) var outAlbedo:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(12) var outNormal:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(13) var outEmissive:texture_storage_2d<r32uint,write>;
@group(0) @binding(14) var outDepth:texture_storage_2d<r32float,write>;
${ENTRY(
  'resamplePages',
  ` let p=vec2i(w.capture);
 let size=vec2f(vec2u(w.rect.z-w.rect.x,w.rect.w-w.rect.y));
 let rectUv=(vec2f(w.local)+vec2f(0.5))/size;
 var cardUv=mix(w.uv.xy,w.uv.zw,rectUv);
 if((w.flags&FLAG_FLIPPED)!=0u){cardUv.x=1.0-cardUv.x;}
 // The card's extent is taken as it was: the texel's place on the card is the same.
 let card=scCard(w.copy);
 let local=scCardLocal(card.extent,cardUv,0.0).xy;
 let s=scComputeSample(card,w.copy,local,0.0,false);
 var albedo=vec4f(0.0);var normal=vec4f(0.5,0.5,0.0,0.0);var emissive=0u;var depth=0.0;
 if(s.valid){
  let b=scGatherBase(s.uv);
  let depths=scDepths4(b);
  // Only the texels that hold a surface count.
  var weights=s.weights*select(vec4f(0.0),vec4f(1.0),depths<vec4f(1.0));
  let sum=dot(weights,vec4f(1.0));
  if(sum>0.0){
   weights=weights/sum;
   albedo=vec4f(scAlbedo4(b,weights),1.0);
   normal=vec4f(scNormal4(b,weights),0.0,1.0);
   emissive=packLight(scEmissive4(b,weights));
   depth=1.0-dot(depths,weights);
  }
 }
 textureStore(outAlbedo,p,albedo);
 textureStore(outNormal,p,normal);
 textureStore(outEmissive,p,vec4u(emissive,0u,0u,0u));
 textureStore(outDepth,p,vec4f(depth,0.0,0.0,0.0));
`,
)}`,
    [CAPTURE_COMMON, packLight, surfaceCacheSampleWgsl(0, 3, { feedback: false, compressed })],
  )

export const RESAMPLE_WGSL = resampleWgsl(false)
export const RESAMPLE_COMPRESSED_WGSL = resampleWgsl(true)

/**
 * The texel a page ends as in the atlas, from the capture atlas's: bindings 3 to 6, the capture atlas's
 * albedo, normal, emission and depth, read. `finalTexel` gives, for the texel of `w`: the albedo and the
 * normal's two components as captured, the emission word, and the depth as the card's — one minus the
 * raster's, 65535 for a texel with no surface —; nothing for a page no capture was made of; the mean of the
 * texels of its page around it that hold a surface, for a texel with none on a page that dilates.
 */
export const CAPTURE_TEXELS = wgslBlock(
  'SURFACE_CACHE_CAPTURE_TEXELS_WGSL',
  [CAPTURE_COMMON, CARD_NORMAL_WGSL],
  `@group(0) @binding(3) var capAlbedo:texture_2d<f32>;
@group(0) @binding(4) var capNormal:texture_2d<f32>;
@group(0) @binding(5) var capEmissive:texture_2d<u32>;
@group(0) @binding(6) var capDepth:texture_2d<f32>;
struct Texel{albedo:vec4f,normal:vec4f,depth:f32}
fn texelAt(p:vec2u)->Texel{
 let q=vec2i(p);
 return Texel(textureLoad(capAlbedo,q,0),textureLoad(capNormal,q,0),textureLoad(capDepth,q,0).x);
}
/** The largest depth a texel with a surface holds: the one under the sixteen-bit one that says none. */
const MAX_VALID_DEPTH:f32=65533.5/65535.0;
struct EndTexel{albedo:vec3f,normal:vec2f,depth:u32,emissive:u32}
fn finalTexel(w:Work)->EndTexel{
 var f=EndTexel(vec3f(0.0),vec2f(0.0),INVALID_DEPTH,0u);
 var t=texelAt(w.capture);
 if((w.flags&FLAG_DILATE)!=0u&&t.normal.w<=0.5){
  // A texel with no surface takes the mean of the texels around it, in its page, that have one.
  var albedoSum=vec4f(0.0);var normalSum=vec3f(0.0);var depthSum=0.0;var count=0.0;
  let size=vec2i(vec2u(w.rect.z-w.rect.x,w.rect.w-w.rect.y));
  for(var dy=-1;dy<=1;dy++){
   for(var dx=-1;dx<=1;dx++){
    let q=vec2i(w.local)+vec2i(dx,dy);
    if((dx==0&&dy==0)||any(q<vec2i(0))||any(q>=size)){continue;}
    let around=texelAt(vec2u(vec2i(w.rect.xy)+q));
    if(around.normal.w>0.5){
     albedoSum+=vec4f(around.albedo.xyz*around.albedo.xyz,around.albedo.w);
     normalSum+=scDecodeCardNormal(around.normal.xy);
     depthSum+=around.depth;
     count+=1.0;
    }
   }
  }
  if(count>0.0){
   let length2=dot(normalSum,normalSum);
   let facing=select(vec3f(0.0,0.0,1.0),normalSum*inverseSqrt(length2),length2>1e-8);
   t.albedo=vec4f(sqrt(albedoSum.xyz/count),albedoSum.w/count);
   t.normal=vec4f(saturate(facing.xy*0.5+vec2f(0.5)),0.0,1.0);
   t.depth=depthSum/count;
  }
 }
 let valid=t.normal.w>0.5;
 let depth=select(1.0,min(1.0-t.depth,MAX_VALID_DEPTH),valid);
 f.depth=u32(round(depth*65535.0));
 f.albedo=t.albedo.xyz;
 f.normal=t.normal.xy;
 f.emissive=textureLoad(capEmissive,vec2i(w.capture),0).x;
 return f;
}
`,
)

/** The kernel that copies the capture atlas's pages into the atlas (`finalTexel`). Bindings 3 to 6 are
 *  the capture atlas's layers, read; 7 the atlas's depth, written, and, unless the atlas is compressed,
 *  8 to 10 its albedo, normal and emission. */
const copyWgsl = (compressed: boolean) =>
  wgslProgram(
    `@group(0) @binding(7) var outDepth:texture_storage_2d<r32uint,write>;
${
  compressed
    ? ''
    : `@group(0) @binding(8) var outAlbedo:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(9) var outNormal:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(10) var outEmissive:texture_storage_2d<r32uint,write>;
`
}${ENTRY(
      'copyPages',
      ` let at=vec2i(w.info.xy+w.local);
 let f=finalTexel(w);
 textureStore(outDepth,at,vec4u(f.depth,0u,0u,0u));
${
  compressed
    ? ''
    : ` textureStore(outAlbedo,at,vec4f(f.albedo,0.0));
 textureStore(outNormal,at,vec4f(f.normal,0.0,0.0));
 textureStore(outEmissive,at,vec4u(f.emissive,0u,0u,0u));
`
}`,
    )}`,
    [CAPTURE_TEXELS],
  )

export const COPY_WGSL = copyWgsl(false)
export const COPY_COMPRESSED_WGSL = copyWgsl(true)

/** The kernel that gives the pages the light they start with. Bindings 3 to 7: the capture atlas's
 *  emission, read; the atlas's direct, indirect and final light and the radiosity's accumulation,
 *  written. */
export const LIGHTS_WGSL = wgslProgram(
  `@group(0) @binding(3) var capEmissive:texture_2d<u32>;
@group(0) @binding(4) var outDirect:texture_storage_2d<r32uint,write>;
@group(0) @binding(5) var outIndirect:texture_storage_2d<r32uint,write>;
@group(0) @binding(6) var outFinal:texture_storage_2d<r32uint,write>;
@group(0) @binding(7) var outFrames:texture_storage_2d<r32uint,write>;
${ENTRY(
  'lightsPages',
  ` // A page captured again keeps the light it held, where the light is carried over.
 if(params.resample!=0u&&(w.flags&FLAG_FRESH)==0u){return;}
 let at=vec2i(w.info.xy+w.local);
 var lit=0u;
 if(params.resample!=0u){lit=textureLoad(capEmissive,vec2i(w.capture),0).x;}
 textureStore(outDirect,at,vec4u(0u));
 textureStore(outIndirect,at,vec4u(0u));
 textureStore(outFinal,at,vec4u(lit,0u,0u,0u));
 if(all(lane.xy==vec2u(0u))){textureStore(outFrames,at/i32(TILE_SIZE),vec4u(0u));}
`,
)}`,
  [CAPTURE_COMMON],
)
