import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { MAX_LIGHTS_PER_TILE } from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { declaredLightWgsl } from '../../direct/lightLoopWgsl.ts'
import { lightStrengthWgsl } from '../../direct/lightStrengthWgsl.ts'
import {
  CM_PER_M_WGSL,
  lightingCommonWgsl,
  VIEW_EXPOSURE,
  lightingLayersWgsl,
  surfaceTexelWgsl,
} from './commonWgsl.ts'
import { directTexelWgsl, storeDirectWgsl } from './directTileWgsl.ts'
import { SHADOW_TEXELS } from './layout.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { shadowMaskBlockOf } from './shadowMaskWgsl.ts'

/**
 * THE DIRECT LIGHT OF THE CARDS' TEXELS: a workgroup a tile of the direct update's list (`contextWgsl.ts`), a thread a
 * texel, which holds the irradiance the tile's lights (`cullWgsl.ts`, the tile's own list of the light tiles that
 * `lightTilesWgsl.ts` places, each with the place of its shadow mask) give its surface, written to the direct layer
 * multiplied by the pre-exposure and dithered in the last place of its word (`ditherLight`, by a hash of the texel and
 * the page's image, so that a light kept over many images does not drift).
 *
 * A light's irradiance at a texel is the engine's one light term for a point that is not a pixel (`declaredBareIrradiance`,
 * `../../direct/lightLoopWgsl.ts`): the falloff, the range, a spot's fade, a rectangle's form factor and the cosine — everything
 * but the shadow and what the masks keep, the light function, the profile and the clouds' shade, which `declaredIrradiance` would add — times
 * the light's factor on its indirect lighting (`gathered`; the cull keeps no light whose factor is not above 0), and times the factor the light's
 * shadow mask gives the texel (`shadowMaskWgsl.ts`: the attenuation of the light, settled by the shadow pass of `shadowTraceWgsl.ts` through the scene's triangles or of
 * `fieldShadowWgsl.ts` through the distance fields), none where the factor is not above 0. The tile then records which of its lights it saw
 * uniformly — every texel above the visible factor, or none; an invalid texel counts as both — in the factor atlas, a bit a light,
 * for the next update's adaptive tracing: the workgroup counts, for each light, the texels that saw it and the texels it did not
 * reach, and one thread builds the words from the counts.
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
  masks: 8,
  factors: 9,
  cardTileOffsets: 10,
} as const

/** What the cards gather of light \`rank\`'s \`irradiance\` on a texel: it times the light's factor on its indirect lighting (\`contactGi.w\`; the
 *  cull keeps no light whose factor is not above 0). */
const GATHERED_TEXT = `
fn gathered(rank:u32,irradiance:vec3f)->vec3f{return irradiance*directLights.items[rank].contactGi.w;}`

export const DIRECT_ENTRY = 'directShade'

/** The direct light's bindings, its counters of the texels that see and are shadowed from each light of a tile, and what records the lights a tile is uniform to. */
const directDeclarations = `${wgslConsts({ MAX_LIGHTS: MAX_LIGHTS_PER_TILE, TILE_TEXELS: SHADOW_TEXELS })}
@group(0) @binding(${DIRECT_BINDINGS.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${DIRECT_BINDINGS.masks}) var<storage,read> masks:array<u32>;
@group(0) @binding(${DIRECT_BINDINGS.factors}) var<storage,read_write> factors:array<u32>;
var<workgroup> visibleTexels:array<atomic<u32>,MAX_LIGHTS>;
var<workgroup> shadowedTexels:array<atomic<u32>,MAX_LIGHTS>;
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
}`

/** The kernel that shades each texel by the shadow rays the masks hold. */
const directEntry = `@compute @workgroup_size(8,8,1)
fn ${DIRECT_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
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
}`

/** The direct light's program over masks in `format`, its light stored in `light`. */
export const directProgramOf = (format: AtlasFormat, light: LightAtlasFormat) =>
  wgslProgram(`${directDeclarations}${GATHERED_TEXT}\n${directEntry}`, [
    lightingCommonWgsl({
      tables: DIRECT_BINDINGS.tables,
      context: { binding: DIRECT_BINDINGS.context, access: 'read' },
    }),
    surfaceTexelWgsl(lightingLayersWgsl(DIRECT_BINDINGS.depth, DIRECT_BINDINGS.normal)),
    CM_PER_M_WGSL,
    DIRECT_LIGHT_WGSL,
    declaredLightWgsl({}, { term: 'bareIrradiance' }),
    lightStrengthWgsl(VIEW_EXPOSURE),
    shadowMaskBlockOf(format),
    directTexelWgsl(DIRECT_BINDINGS),
    storeDirectWgsl(DIRECT_BINDINGS.out, light),
  ])
