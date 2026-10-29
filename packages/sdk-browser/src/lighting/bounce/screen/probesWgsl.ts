import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { octBytesDecode, octEncode } from '../../../../../math/src/wgsl/octahedral.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../../materials/surface/pixelModel.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { SURFACE_MODEL_MASK, MODEL_FLAG } from '../../../materials/surface/surfaceModelWord.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { CACHE_WORDS_WGSL } from '../cache/cacheWordsWgsl.ts'
import { PDF_LOBE_WORDS, SCREEN_PROBE_FORMATS as F } from './screenProbeLayout.ts'

/**
 * THE WEIGHTS OF THE PROBES ROUND A PIXEL: bilinear in the tile — the pixel's place in it cut to a whole pixel once the tile's
 * jitter and the read's noise are in —, each corner's by how near its plane the pixel's point lies
 * — `exp2(scale · (distance / depth)²)`, the scale the parameters'. A kernel that reads them names the uniform probes it
 * reads (`spCornerProbe(tile)`: a record, or the surface's own where the record is not made yet) beside this block.
 */
export const spWeights = wgslBlock(
  'spWeights',
  [],
  `/** The scale of the depth weight of a pixel: the foliage's where it has backface diffuse light, else the plane's. */
fn spDepthWeight(foliage:bool)->f32{return select(sp.weights.x,sp.foliage.z,foliage);}
/** The weights of the four uniform probes of the tile round a pixel: \`w\`, each by its plane and its place in the tile;
 *  \`fallback\`, by a gentler plane, for a pixel the first leaves bare; \`tile\`, the first probe's tile. */
struct SpWeights{w:vec4f,fallback:vec4f,tile:vec2u,}
fn spInterpolation(pixel:vec2u,noise:vec2f,P:vec3f,N:vec3f,depth:f32,foliage:bool)->SpWeights{
 let size=vec2f(sp.size.xy);
 let full=floor(clamp(vec2f(pixel)-vec2f(spTileJitter(sp.mode.x))+noise,vec2f(0.0),size-vec2f(1.0)));
 let last=max(sp.grid.xy,vec2u(2u))-vec2u(2u);
 let tile=min(vec2u(full/f32(sp.size.z)),last);
 let bilinear=(full-vec2f(tile*sp.size.z)+vec2f(1.0))/f32(sp.size.z+2u);
 let edge=sp.grid.xy-vec2u(1u);
 let a=spCornerProbe(tile);
 let b=spCornerProbe(min(tile+vec2u(1u,0u),edge));
 let c=spCornerProbe(min(tile+vec2u(0u,1u),edge));
 let e=spCornerProbe(min(tile+vec2u(1u,1u),edge));
 let plane=dot(P,N);
 let away=vec4f(abs(dot(a.P,N)-plane),abs(dot(b.P,N)-plane),abs(dot(c.P,N)-plane),abs(dot(e.P,N)-plane))/depth;
 let relative=away*away;
 let valid=vec4<bool>(a.depth>0.0,b.depth>0.0,c.depth>0.0,e.depth>0.0);
 let blend=vec4f(
  (1.0-bilinear.y)*(1.0-bilinear.x),(1.0-bilinear.y)*bilinear.x,
  bilinear.y*(1.0-bilinear.x),bilinear.y*bilinear.x);
 let depthWeights=select(vec4f(0.0),exp2(spDepthWeight(foliage)*relative),valid);
 let fallbackWeights=select(vec4f(0.0),exp2(sp.weights.y*relative),valid);
 return SpWeights(blend*depthWeights,blend*fallbackWeights,tile);
}
/** The weight of an adaptive probe at pixel \`probePixel\`, of world point \`probe\`, for a pixel: its plane's, as the uniform
 *  ones', and its nearness along the nearer axis of the tile's side; the fallback's in \`y\`. */
fn spAdaptiveWeight(pixel:vec2u,P:vec3f,N:vec3f,depth:f32,foliage:bool,probePixel:vec2u,probe:vec3f)->vec2f{
 let away=abs(dot(probe,N)-dot(P,N))/depth;
 let relative=away*away;
 let across=abs(vec2f(probePixel)-vec2f(pixel));
 let corner=1.0-saturate(min(across.x,across.y)/f32(sp.size.z));
 return vec2f(exp2(spDepthWeight(foliage)*relative),exp2(sp.weights.y*relative))*corner;
}`,
)

/**
 * The surface a pixel shows, as every screen-probe kernel reads it: the image's depth through the depth
 * pyramid's first level (`hizOpaqueDepth`), the normal and the surface flags at `normals` and `flags`
 * of group 0. A pixel is lit when a surface was drawn there (a depth above zero: reverse-Z) of a model that
 * the light reaches — the physical, diffuse and toon ones — and its normal is one. `z` is its device depth; `hair` whether its
 * shading model is the hair's; `foliage` whether it has backface diffuse light (a thin double-sided sheet or a subsurface material), which
 * sets its depth weights, its pdf lobe and its history apart; `backface` whether it gathers that light (a sheet, where the setting asks).
 */
export const spSurface = (normals: number, flags: number) =>
  wgslBlock(
    `spSurface(${normals}, ${flags})`,
    [WORLD_AT_WGSL, pixelModelOf],
    `@group(0) @binding(${normals}) var sceneNormals:texture_2d<f32>;
@group(0) @binding(${flags}) var sceneFlags:texture_2d<u32>;
struct SpSurface{lit:bool,P:vec3f,N:vec3f,z:f32,hair:bool,foliage:bool,backface:bool,}
fn spSurfaceAt(pix:vec2u)->SpSurface{
 let coord=vec2i(pix);
 let z=hizOpaqueDepth(coord);
 let flags=textureLoad(sceneFlags,coord,0).r;
 let model=flags&${SURFACE_MODEL_MASK}u;
 let n=textureLoad(sceneNormals,coord,0).xyz;
 let facing=dot(n,n)>0.5;
 // A pixel with light through its back: a thin double-sided sheet, or a subsurface surface whatever its colour.
 let foliage=(flags&${SUBSURFACE_FLAG}u)!=0u||pixelModelOf(flags)==${PIXEL_MODEL.subsurface}u;
 let lit=z>0.0&&facing&&(model==${MODEL_FLAG.physical}u||model==${MODEL_FLAG.diffuse}u||model==${MODEL_FLAG.toon}u);
 return SpSurface(
  lit,worldAt(vec2f(pix)+vec2f(0.5),z),select(vec3f(0.0,0.0,1.0),normalize(n),facing),z,
  pixelModelOf(flags)==${PIXEL_MODEL.hair}u,foliage,spFlag(SP_FLAG_BACKFACE_DIFFUSE)&&foliage);
}`,
  )

/** The word of a probe's normal, speed and kind (`SCREEN_PROBE_FORMATS.normal`): the normal as the octahedral pair `n · ½ + ½` on a byte each,
 *  rounded to the nearest of 255 steps as an 8-bit normalised write is, then the speed as a half float in the high half, without its sign
 *  and the last bit of its mantissa: the sign bit holds whether the surface has backface diffuse light, the last bit whether it is hair. */
export const spProbeWord = wgslFn(
  'spProbeWord',
  [octEncode],
  `fn spProbeWord(n:vec3f,speed:f32,foliage:bool,hair:bool)->u32{
 let q=vec2u(floor(clamp(octEncode(n)*0.5+0.5,vec2f(0.0),vec2f(1.0))*255.0+0.5));
 let kind=(pack2x16float(vec2f(speed,0.0))&0x7ffeu)|select(0u,0x8000u,foliage)|select(0u,1u,hair);
 return q.x|(q.y<<8u)|(kind<<16u);
}`,
)

/** The normal of a probe's word (`spProbeWord`): the pair of bytes back to `[-1, 1]` and unfolded, the unit vector. */
const spProbeNormal = wgslFn(
  'spProbeNormal',
  [octBytesDecode],
  'fn spProbeNormal(word:u32)->vec3f{return octBytesDecode(word,0u);}',
)

/** The speed of a probe's word (`spProbeWord`). */
const spProbeSpeed = wgslFn(
  'spProbeSpeed',
  [],
  'fn spProbeSpeed(word:u32)->f32{return unpack2x16float((word>>16u)&0x7ffeu).x;}',
)

/** The coefficients of the directions the pixels of a probe face, as a kernel reads them from the storage `brdfSh` at `binding`: the
 *  coefficient `k` of the probe `index` (`spPdfCoefficient`) is a half float of its group of words (`PDF_LOBE_WORDS`), two to a word. */
export const spPdfLobes = (binding: number) =>
  wgslBlock(
    `spPdfLobes(${binding})`,
    [],
    `@group(0) @binding(${binding}) var<storage,read> brdfSh:array<u32>;
fn spPdfCoefficient(index:u32,k:u32)->f32{
 let pair=unpack2x16float(brdfSh[index*${PDF_LOBE_WORDS}u+(k>>1u)]);
 return select(pair.x,pair.y,(k&1u)==1u);
}`,
  )

/** The probes' records as a kernel reads them: the world point and signed depth, the normal, speed and kind (`spReadProbe`). The
 *  points are a sampled texture, or, where `stored`, a texture read as the storage it is written through: none of the stage's
 *  sixteen sampled textures spent on it. */
export const spProbeRecords = (info: number, normal: number, stored = false) =>
  wgslBlock(
    `spProbeRecords(${info}, ${normal}, ${stored})`,
    [spProbeNormal, spProbeSpeed],
    `@group(0) @binding(${info}) var probeInfo:${stored ? `texture_storage_2d<${F.info},read>` : 'texture_2d<f32>'};
@group(0) @binding(${normal}) var probeNormal:texture_2d<u32>;
fn spReadProbe(atlas:vec2u)->SpProbe{
 let a=${stored ? 'textureLoad(probeInfo,vec2i(atlas))' : 'textureLoad(probeInfo,vec2i(atlas),0)'};
 let word=textureLoad(probeNormal,vec2i(atlas),0).x;
 return SpProbe(a.xyz,a.w,spProbeNormal(word),spProbeSpeed(word),(word>>31u)!=0u,((word>>16u)&1u)!=0u);
}
/** Whether what a ray of \`probe\` met moves against it: their speeds differ by more than the setting's share of the probe's depth, a metre at least (\`sp.motion.x\`). */
fn spHitMoving(probe:SpProbe,speed:f32)->bool{return abs(probe.speed-speed)/max(probe.depth,1.0)>sp.motion.x;}`,
  )

/** The probes' records and `probeCounts` the adaptive probes placed (`spProbeLive`), and the record of a probe placed or an
 *  empty one where the index is past them (`spProbeOrDead`). */
export const spProbes = (info: number, normal: number, counts: number) =>
  wgslBlock(
    `spProbes(${info}, ${normal}, ${counts})`,
    [spProbeRecords(info, normal)],
    `@group(0) @binding(${counts}) var<storage,read> probeCounts:array<u32>;
fn spProbeLive(index:u32)->bool{
 return index<sp.counts.y+min(probeCounts[0],sp.grid.w);
}
fn spProbeOrDead(atlas:vec2u)->SpProbe{
 if(spProbeLive(spIndexOf(atlas))){return spReadProbe(atlas);}
 return SpProbe(vec3f(0.0),-1.0,vec3f(0.0),0.0,false,false);
}`,
  )

/**
 * THE RANGE THE SCREEN IS TRUSTED TO, and the scene is traced over: the distance the radiance cache asks to be traced before it
 * is read (`spLocalReach`, `CacheCoverage.minTrace`: twice the diagonal of the cell of the finest level that covers the point),
 * or the scene's limit where the cache is not read or covers none. A kernel names the bounce grid (`bounce`) beside this block.
 */
export const spReach = wgslBlock(
  'spReach',
  [CACHE_WORDS_WGSL],
  `fn spLocalReachBiased(P:vec3f,bias:u32,random:f32)->f32{
 if(!spFlag(SP_FLAG_CACHE)){return spMaxTrace();}
 let cover=cacheCoverageBiased(P,bias,random);
 return select(spMaxTrace(),min(spMaxTrace(),cover.minTrace),cover.valid);
}
fn spLocalReach(P:vec3f)->f32{return spLocalReachBiased(P,0u,0.0);}`,
)
