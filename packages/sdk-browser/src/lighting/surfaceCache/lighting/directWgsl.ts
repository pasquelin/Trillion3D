import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import { MAX_LIGHTS_PER_TILE } from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { ditherLight, packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import type { CloudShadowBindings } from '../../atmosphere/cloudShadowRead.ts'
import { cloudShadowReadWgsl } from '../../atmosphere/cloudShadowRead.ts'
import { globalDistanceFieldTraceWgsl } from '../../distanceField/globalTraceWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { declaredLightWgsl } from '../../direct/lightLoopWgsl.ts'
import { lightFunctionReadWgsl, type LightFunctionBindings } from '../../lightFunction/readWgsl.ts'
import {
  CM_PER_M_WGSL,
  lightingCommonWgsl,
  lightingLayersWgsl,
  surfaceTexelWgsl,
} from './commonWgsl.ts'
import { SHADOW_TEXELS } from './layout.ts'
import { SHADOW_MASK_WGSL } from './shadowMaskWgsl.ts'

/**
 * THE DIRECT LIGHT OF THE CARDS' TEXELS: a workgroup a tile of the direct update's list (`contextWgsl.ts`), a thread a
 * texel, which holds the irradiance the tile's lights (`cullWgsl.ts`) give its surface, written to the direct layer
 * multiplied by the pre-exposure and dithered in the last place of its word (`ditherLight`, by a hash of the texel and
 * the page's image, so that a light kept over many images does not drift).
 *
 * A light's irradiance at a texel (`cacheIrradiance`) is the engine's one light term for a point that is not a pixel
 * (`declaredIrradiance`, `../../direct/lightLoopWgsl.ts`): the falloff, the range, a spot's fade, a rectangle's form factor, the
 * cosine, the light function and the clouds' shade, the air's tint toward a sun — everything but its shadow, which the term leaves out. The shadow of a light that casts one and lights the texel is one ray marched through the global distance field
 * (`cacheShadowed`) from the texel to the light, as far as the trace reaches or the lamp is: it starts off the surface by
 * `shadowBias` voxels of the clipmap it begins in, three where the surface turns from the light (`shadowRayBias`), and a lamp's
 * ray ends a bias short of it; it is shadowed where it meets a surface.
 *
 * `directShadeTraced` is the same light with the shadow of the shadow masks instead (`shadowMaskWgsl.ts`, settled by the
 * traces of `shadowTraceWgsl.ts`): a light's irradiance without its function and clouds' shade
 * (`declaredBareIrradiance`) times the factor the light's mask gives the texel, none where the factor is not above 0. The
 * tile then records which of its lights it saw uniformly — every texel above the visible factor, or none; an
 * invalid texel counts as both — in the factor atlas, a bit a light, for the next update's adaptive tracing: the workgroup
 * counts, for each light, the texels that saw it and the texels it did not reach, and one thread builds the words from the
 * counts. `directShade` records none: it empties the tile's words, so that the next traced update of the tile traces
 * every texel.
 *
 * Lengths here are the cards' unit, the centimetre; the light term takes metres, the engine's.
 */

/** The bindings of the direct light's program. */
export const DIRECT_BINDINGS = {
  tables: 1,
  context: 2,
  depth: 3,
  normal: 4,
  tileLights: 5,
  out: 6,
  lights: 7,
  lightFunction: 8,
  cloudBlock: 9,
  cloudMap0: 10,
  cloudMap1: 11,
  cloudSampler: 12,
  field: 13,
  masks: 19,
  factors: 20,
} as const

/** Where the direct light's program reads the light functions, and the eye their fade is measured from. */
const DIRECT_LIGHT_FUNCTION: LightFunctionBindings = {
  group: 0,
  atlas: DIRECT_BINDINGS.lightFunction,
  eye: 'lp.eye.xyz',
}

/** Where the direct light's program reads the clouds' shade. */
export const DIRECT_CLOUD_SHADOW: CloudShadowBindings = {
  group: 0,
  block: DIRECT_BINDINGS.cloudBlock,
  map0: DIRECT_BINDINGS.cloudMap0,
  map1: DIRECT_BINDINGS.cloudMap1,
  sampler: DIRECT_BINDINGS.cloudSampler,
}

/** The light a texel receives from light `rank`, its shadow traced through the global distance field. */
const CACHE_IRRADIANCE_WGSL = wgslBlock(
  'CACHE_IRRADIANCE_WGSL',
  [
    DIRECT_LIGHT_WGSL,
    CM_PER_M_WGSL,
    lightFunctionReadWgsl(DIRECT_LIGHT_FUNCTION),
    cloudShadowReadWgsl(DIRECT_CLOUD_SHADOW),
    declaredLightWgsl({}, { term: 'irradiance' }),
    declaredLightWgsl({}, { term: 'bareIrradiance' }),
    globalDistanceFieldTraceWgsl(0, DIRECT_BINDINGS.field),
  ],
  `
/** The distance, in voxels, a shadow ray starts off a texel whose normal makes the cosine \`nDotL\` with the light. */
fn shadowRayBias(nDotL:f32,bias:f32)->f32{return bias+2.0*bias*saturate(1.0-nDotL);}
/** Whether the ray from the world point \`at\` along \`toward\`, \`span\` long, meets a surface of the global field. */
fn cacheShadowed(at:vec3f,normal:vec3f,toward:vec3f,span:f32,lamp:bool)->bool{
 var ray=gdfTraceInput(gdfTranslated(at),toward,0.0,span,1.0,1.0);
 ray.rayBias=shadowRayBias(dot(normal,toward),lp.shadowBias);
 if(lamp){ray.rayEndBias=lp.shadowBias;}
 return gdfTrace(ray).hitTime>=0.0;
}
fn cacheIrradiance(rank:u32,position:vec3f,normal:vec3f)->vec3f{
 let lit=declaredIrradiance(rank,position/CM_PER_M,normal,0.0);
 if(all(lit==vec3f(0.0))){return lit;}
 let light=directLights.items[rank];
 if(!castsShadow(light)){return lit;}
 let sun=isSun(light);
 let offset=light.positionRange.xyz*CM_PER_M-position;
 let toward=select(normalize(offset),-light.directionCone.xyz,sun);
 let span=select(min(length(offset),lp.maxTrace),lp.maxTrace,sun);
 return select(lit,vec3f(0.0),cacheShadowed(position,normal,toward,span,!sun));
}`,
)

export const DIRECT_ENTRY = 'directShade'
export const DIRECT_TRACED_ENTRY = 'directShadeTraced'
export const DIRECT_ENTRIES = [DIRECT_ENTRY, DIRECT_TRACED_ENTRY] as const

/** The direct light's program. */
export const DIRECT_WGSL = wgslProgram(
  `${wgslConsts({ MAX_LIGHTS: MAX_LIGHTS_PER_TILE, TILE_TEXELS: SHADOW_TEXELS })}
@group(0) @binding(${DIRECT_BINDINGS.tileLights}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${DIRECT_BINDINGS.out}) var outDirect:texture_storage_2d<r32uint,write>;
@group(0) @binding(${DIRECT_BINDINGS.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${DIRECT_BINDINGS.masks}) var<storage,read> masks:array<u32>;
@group(0) @binding(${DIRECT_BINDINGS.factors}) var<storage,read_write> factors:array<u32>;
var<workgroup> visibleTexels:array<atomic<u32>,MAX_LIGHTS>;
var<workgroup> shadowedTexels:array<atomic<u32>,MAX_LIGHTS>;
/** Writes the direct light of the texel, kept multiplied by the pre-exposure and dithered by a hash of the texel and the page's image. */
fn storeDirect(page:u32,texel:SurfaceTexel,irradiance:vec3f){
 let seed=vec3i(i32(texel.atlas.x),i32(texel.atlas.y),i32(scPageW(page,18u)));
 let noise=f32(rand3dPcg16(seed).x)/65536.0;
 textureStore(outDirect,vec2i(texel.atlas),vec4u(packLight(ditherLight(irradiance*lp.preExposure,noise)),0u,0u,0u));
}
/** What a thread of the direct light starts from: the tile of the list \`tile\` (its page and its place in it), its texel, and the
 *  lights the tile keeps — none where the direct light is off — at \`first\` in the tiles' lights. */
struct DirectTexel{page:u32,coord:vec2u,texel:SurfaceTexel,first:u32,lights:u32}
fn directTexel(tile:u32,at:vec2u)->DirectTexel{
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 let first=tile*(lp.maxLights+1u);
 return DirectTexel(page,coord,surfaceTexel(page,coord*LG_TILE+at),first,select(0u,tileLights[first],lgFlag(FLAG_DIRECT)));
}
@compute @workgroup_size(8,8,1)
fn ${DIRECT_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let head=directTexel(tile,at.xy);
 var irradiance=vec3f(0.0);
 if(head.texel.valid){
  for(var k=0u;k<head.lights;k++){
   irradiance+=cacheIrradiance(tileLights[head.first+1u+k],head.texel.position,head.texel.normal);
  }
 }
 // The tile saw no light uniformly as far as the next traced update knows: it traces every texel.
 if(lane==0u){
  let at0=cardTileFactorWord(head.page,head.coord);
  for(var i=0u;i<FACTOR_TILE_WORDS;i++){factors[at0+i]=0u;}
 }
 storeDirect(head.page,head.texel,irradiance);
}
@compute @workgroup_size(8,8,1)
fn ${DIRECT_TRACED_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let head=directTexel(tile,at.xy);
 let bit=shadowBit(at.xy);
 var irradiance=vec3f(0.0);
 for(var k=0u;k<head.lights;k++){
  // A texel that holds no surface counts as seeing the light and as shadowed from it.
  var visible=true;
  var shadowed=true;
  if(head.texel.valid){
   let ray=shadowRayOf(shadowByteIn(masks[(tile*lp.maxLights+k)*SHADOW_MASK_TILE_WORDS+bit/32u],bit));
   visible=isVisibleToLight(ray.factor);
   shadowed=!visible;
   if(ray.factor>0.0){irradiance+=declaredBareIrradiance(tileLights[head.first+1u+k],head.texel.position/CM_PER_M,head.texel.normal,0.0)*ray.factor;}
  }
  if(visible){atomicAdd(&visibleTexels[k],1u);}
  if(shadowed){atomicAdd(&shadowedTexels[k],1u);}
 }
 workgroupBarrier();
 // The tile is uniform to a light where every texel sees it or every texel is shadowed from it.
 if(lane==0u){
  var seen=array<u32,FACTOR_TILE_WORDS>();
  for(var k=0u;k<head.lights;k++){
   if(atomicLoad(&visibleTexels[k])==TILE_TEXELS||atomicLoad(&shadowedTexels[k])==TILE_TEXELS){
    let rank=tileLights[head.first+1u+k];
    seen[factorWordOf(rank)]|=factorBitOf(rank);
   }
  }
  let at0=cardTileFactorWord(head.page,head.coord);
  for(var i=0u;i<FACTOR_TILE_WORDS;i++){factors[at0+i]=seen[i];}
 }
 storeDirect(head.page,head.texel,irradiance);
}`,
  [
    lightingCommonWgsl({
      tables: DIRECT_BINDINGS.tables,
      context: { binding: DIRECT_BINDINGS.context, access: 'read' },
    }),
    surfaceTexelWgsl(lightingLayersWgsl(DIRECT_BINDINGS.depth, DIRECT_BINDINGS.normal)),
    CACHE_IRRADIANCE_WGSL,
    SHADOW_MASK_WGSL,
    packLight,
    ditherLight,
    rand3dPcg16,
  ],
)
