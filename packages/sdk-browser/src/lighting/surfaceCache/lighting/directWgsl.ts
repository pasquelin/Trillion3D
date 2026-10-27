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
import { lightStrengthWgsl } from '../../direct/lightStrengthWgsl.ts'
import { lightFunctionReadWgsl, type LightFunctionBindings } from '../../lightFunction/readWgsl.ts'
import {
  CM_PER_M_WGSL,
  lightingCommonWgsl,
  VIEW_EXPOSURE,
  lightingLayersWgsl,
  surfaceTexelWgsl,
} from './commonWgsl.ts'
import { SHADOW_TEXELS } from './layout.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { LIGHT_CENTRE_FACING_WGSL, shadowMaskBlockOf } from './shadowMaskWgsl.ts'

/**
 * THE DIRECT LIGHT OF THE CARDS' TEXELS: a workgroup a tile of the direct update's list (`contextWgsl.ts`), a thread a
 * texel, which holds the irradiance the tile's lights (`cullWgsl.ts`, the tile's own list of the light tiles that
 * `lightTilesWgsl.ts` places, each with the place of its shadow mask) give its surface, written to the direct layer
 * multiplied by the pre-exposure and dithered in the last place of its word (`ditherLight`, by a hash of the texel and
 * the page's image, so that a light kept over many images does not drift).
 *
 * A light's irradiance at a texel (`cacheLight`) is the engine's one light term for a point that is not a pixel
 * (`declaredIrradiance`, `../../direct/lightLoopWgsl.ts`): the falloff, the range, a spot's fade, a rectangle's form factor, the
 * cosine, the light function and the clouds' shade, the air's tint toward a sun at the ground (`airGroundTintOf`: a tint a
 * light, not a texel's) — everything but its shadow, which the term leaves out —, times the light's factor on its indirect lighting (`gathered`). A texel that does not face the light's centre
 * takes none of it and casts no ray (`facesLightCentre`). The shadow of a light that casts one and lights the texel is one ray marched through the global distance field
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
 * counts. `directShade` records the same from its own shadow: a texel the light reaches sees it where it casts none or
 * its ray met nothing, and is shadowed from it where the ray met a surface; a texel it gives nothing is shadowed from it (no
 * ray cast: the attenuation the masks keep for such a texel, nil).
 *
 * Lengths here are the cards' unit, the centimetre; the light term takes metres, the engine's.
 */

/** The bindings of the direct light's program. */
export const DIRECT_BINDINGS = {
  tables: 1,
  context: 2,
  depth: 3,
  normal: 4,
  cardTileLights: 5,
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
  cardTileOffsets: 21,
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
const CACHE_LIGHT_WGSL = wgslBlock(
  'CACHE_LIGHT_WGSL',
  [
    DIRECT_LIGHT_WGSL,
    LIGHT_CENTRE_FACING_WGSL,
    CM_PER_M_WGSL,
    lightFunctionReadWgsl(DIRECT_LIGHT_FUNCTION),
    cloudShadowReadWgsl(DIRECT_CLOUD_SHADOW),
    declaredLightWgsl({}, { term: 'irradiance' }),
    declaredLightWgsl({}, { term: 'bareIrradiance' }),
    globalDistanceFieldTraceWgsl(0, DIRECT_BINDINGS.field),
  ],
  `
/** What the cards gather of light \`rank\`'s \`irradiance\` on a texel: it times the light's factor on its indirect lighting (\`contactGi.w\`; the
 *  cull keeps no light whose factor is not above 0). */
fn gathered(rank:u32,irradiance:vec3f)->vec3f{return irradiance*directLights.items[rank].contactGi.w;}
/** The distance, in voxels, a shadow ray starts off a texel whose normal makes the cosine \`nDotL\` with the light. */
fn shadowRayBias(nDotL:f32,bias:f32)->f32{return bias+2.0*bias*saturate(1.0-nDotL);}
/** Whether the ray from the world point \`at\` along \`toward\`, \`span\` long, meets a surface of the global field. */
fn cacheShadowed(at:vec3f,normal:vec3f,toward:vec3f,span:f32,lamp:bool)->bool{
 var ray=gdfTraceInput(gdfTranslated(at),toward,0.0,span,1.0,1.0);
 ray.rayBias=shadowRayBias(dot(normal,toward),lp.shadowBias);
 if(lamp){ray.rayEndBias=lp.shadowBias;}
 return gdfTrace(ray).hitTime>=0.0;
}
/** What a light gives a texel (\`share\` the part of it a light function the atlas holds no slot of lets through, 1 for any other): its irradiance, shadow included, and what its shadow ray answered — \`visible\` where the light casts
 *  none or the ray met nothing, \`shadowed\` where it met a surface or where the light gives the texel nothing, whether it casts
 *  a shadow or not — no ray cast, the attenuation nil as the masks have it (\`lightAttenuation\`). */
struct CacheLight{irradiance:vec3f,visible:bool,shadowed:bool}
fn cacheLight(rank:u32,standalone:bool,share:f32,position:vec3f,normal:vec3f)->CacheLight{
 var seen=CacheLight(gathered(rank,declaredIrradiance(rank,position/CM_PER_M,normal,0.0)),false,false);
 let light=directLights.items[rank];
 if(all(seen.irradiance==vec3f(0.0))){seen.shadowed=true;return seen;}
 if(!facesLightCentre(rank,light,position/CM_PER_M,normal,standalone)){seen.irradiance=vec3f(0.0);seen.shadowed=true;return seen;}
 if(standalone){
  seen.irradiance*=share;
  if(!isVisibleScalar(share)){seen.shadowed=true;return seen;}
 }
 if(!castsShadow(light)){seen.visible=true;return seen;}
 let sun=isSun(light);
 let offset=light.positionRange.xyz*CM_PER_M-position;
 let toward=select(normalize(offset),-light.directionCone.xyz,sun);
 let span=select(min(length(offset),lp.maxTrace),lp.maxTrace,sun);
 seen.shadowed=cacheShadowed(position,normal,toward,span,!sun);
 seen.visible=!seen.shadowed;
 if(seen.shadowed){seen.irradiance=vec3f(0.0);}
 return seen;
}`,
)

export const DIRECT_ENTRY = 'directShade'
export const DIRECT_TRACED_ENTRY = 'directShadeTraced'
export const DIRECT_ENTRIES = [DIRECT_ENTRY, DIRECT_TRACED_ENTRY] as const

/** The direct light's program. */
const directProgram = (format: AtlasFormat) =>
  wgslProgram(
    `${wgslConsts({ MAX_LIGHTS: MAX_LIGHTS_PER_TILE, TILE_TEXELS: SHADOW_TEXELS })}
@group(0) @binding(${DIRECT_BINDINGS.cardTileLights}) var<storage,read> cardTileLights:array<u32>;
@group(0) @binding(${DIRECT_BINDINGS.cardTileOffsets}) var<storage,read> cardTileOffsets:array<u32>;
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
 *  lights the tile keeps — none where the direct light is off — from \`first\` in the tiles' lights. */
struct DirectTexel{page:u32,coord:vec2u,texel:SurfaceTexel,first:u32,lights:u32}
fn directTexel(tile:u32,at:vec2u)->DirectTexel{
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 let first=cardTileOffsets[tile*CARD_TILE_OFFSET_WORDS];
 return DirectTexel(page,coord,surfaceTexel(page,coord*LG_TILE+at),first,select(0u,cardTileOffsets[tile*CARD_TILE_OFFSET_WORDS+1u],lgFlag(FLAG_DIRECT)));
}
/** The word of light \`k\` of the tile (its rank and whether the atlas holds no slot of its function), and the place of its light tile
 *  in the compacted list, the index of its mask. */
fn tileLightWord(head:DirectTexel,k:u32)->u32{return cardTileLights[(head.first+k)*LIGHT_TILE_WORDS];}
fn tileLightMask(head:DirectTexel,k:u32)->u32{return cardTileLights[(head.first+k)*LIGHT_TILE_WORDS+1u];}
/** Counts the texel as seeing the tile's light \`k\` and as shadowed from it, as \`visible\` and \`shadowed\` say. */
fn countLight(k:u32,visible:bool,shadowed:bool){
 if(visible){atomicAdd(&visibleTexels[k],1u);}
 if(shadowed){atomicAdd(&shadowedTexels[k],1u);}
}
/** Records, in the tile's words of the factor atlas, the lights the tile is uniform to — every texel sees it or every texel is
 *  shadowed from it — once every thread of the tile has counted. */
fn recordUniformLights(head:DirectTexel,lane:u32){
 workgroupBarrier();
 if(lane==0u){
  var seen=array<u32,FACTOR_TILE_WORDS>();
  for(var k=0u;k<head.lights;k++){
   if(atomicLoad(&visibleTexels[k])==TILE_TEXELS||atomicLoad(&shadowedTexels[k])==TILE_TEXELS){
    let rank=tileLightRank(tileLightWord(head,k));
    seen[factorWordOf(rank)]|=factorBitOf(rank);
   }
  }
  let at0=cardTileFactorWord(head.page,head.coord);
  for(var i=0u;i<FACTOR_TILE_WORDS;i++){factors[at0+i]=seen[i];}
 }
}
@compute @workgroup_size(8,8,1)
fn ${DIRECT_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let head=directTexel(tile,at.xy);
 var irradiance=vec3f(0.0);
 for(var k=0u;k<head.lights;k++){
  // A texel that holds no surface counts as seeing the light and as shadowed from it.
  var seen=CacheLight(vec3f(0.0),true,true);
  if(head.texel.valid){
   let listed=tileLightWord(head,k);
   let standalone=tileLightStandalone(listed);
   var share=1.0;
   if(standalone){
    let i=at.x+at.y*LG_TILE;
    share=scratchFactorIn(masks[scratchWordOf(tileLightMask(head,k),i)],i);
   }
   seen=cacheLight(tileLightRank(listed),standalone,share,head.texel.position,head.texel.normal);
   irradiance+=seen.irradiance;
  }
  countLight(k,seen.visible,seen.shadowed);
 }
 recordUniformLights(head,lane);
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
   let ray=shadowRayOf(shadowByteIn(masks[tileLightMask(head,k)*SHADOW_MASK_TILE_WORDS+bit/32u],bit));
   visible=isVisibleToLight(ray.factor);
   shadowed=!visible;
   if(shadowReaches(ray.factor)){
    let rank=tileLightRank(tileLightWord(head,k));
    irradiance+=gathered(rank,declaredBareIrradiance(rank,head.texel.position/CM_PER_M,head.texel.normal,0.0))*ray.factor;
   }
  }
  countLight(k,visible,shadowed);
 }
 recordUniformLights(head,lane);
 storeDirect(head.page,head.texel,irradiance);
}`,
    [
      lightingCommonWgsl({
        tables: DIRECT_BINDINGS.tables,
        context: { binding: DIRECT_BINDINGS.context, access: 'read' },
      }),
      surfaceTexelWgsl(lightingLayersWgsl(DIRECT_BINDINGS.depth, DIRECT_BINDINGS.normal)),
      CACHE_LIGHT_WGSL,
      lightStrengthWgsl(VIEW_EXPOSURE),
      shadowMaskBlockOf(format),
      packLight,
      ditherLight,
      rand3dPcg16,
    ],
  )

/** The direct light's program over masks in the grey format, and over those of the light functions' coloured atlas. */
export const DIRECT_WGSL = directProgram('grey')
export const DIRECT_COLOURED_WGSL = directProgram('colour')
