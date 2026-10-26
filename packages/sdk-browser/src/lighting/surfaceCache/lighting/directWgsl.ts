import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import { ditherLight, packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import type { CloudShadowBindings } from '../../atmosphere/cloudShadowRead.ts'
import { cloudShadowReadWgsl } from '../../atmosphere/cloudShadowRead.ts'
import { globalDistanceFieldTraceWgsl } from '../../distanceField/globalTraceWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { declaredLightWgsl } from '../../direct/lightLoopWgsl.ts'
import { lightFunctionReadWgsl, type LightFunctionBindings } from '../../lightFunction/readWgsl.ts'
import { lightingCommonWgsl, lightingLayersWgsl, surfaceTexelWgsl } from './commonWgsl.ts'

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
    lightFunctionReadWgsl(DIRECT_LIGHT_FUNCTION),
    cloudShadowReadWgsl(DIRECT_CLOUD_SHADOW),
    declaredLightWgsl({}, { term: 'irradiance' }),
    globalDistanceFieldTraceWgsl(0, DIRECT_BINDINGS.field),
  ],
  `
const CM_PER_M:f32=${CM}.0;
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

/** The direct light's program. */
export const DIRECT_WGSL = wgslProgram(
  `@group(0) @binding(${DIRECT_BINDINGS.tileLights}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${DIRECT_BINDINGS.out}) var outDirect:texture_storage_2d<r32uint,write>;
@group(0) @binding(${DIRECT_BINDINGS.lights}) var<storage,read> directLights:DirectLights;
@compute @workgroup_size(8,8,1)
fn ${DIRECT_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let texel=surfaceTexel(page,tileCoordOf(packed)*LG_TILE+at.xy);
 var irradiance=vec3f(0.0);
 if(texel.valid&&lgFlag(FLAG_DIRECT)){
  let first=tile*(lp.maxLights+1u);
  for(var k=0u;k<tileLights[first];k++){
   irradiance+=cacheIrradiance(tileLights[first+1u+k],texel.position,texel.normal);
  }
 }
 let seed=vec3i(i32(texel.atlas.x),i32(texel.atlas.y),i32(scPageW(page,18u)));
 let noise=f32(rand3dPcg16(seed).x)/65536.0;
 textureStore(outDirect,vec2i(texel.atlas),vec4u(packLight(ditherLight(irradiance*lp.preExposure,noise)),0u,0u,0u));
}`,
  [
    lightingCommonWgsl({
      tables: DIRECT_BINDINGS.tables,
      context: { binding: DIRECT_BINDINGS.context, access: 'read' },
    }),
    surfaceTexelWgsl(lightingLayersWgsl(DIRECT_BINDINGS.depth, DIRECT_BINDINGS.normal)),
    CACHE_IRRADIANCE_WGSL,
    packLight,
    ditherLight,
    rand3dPcg16,
  ],
)
