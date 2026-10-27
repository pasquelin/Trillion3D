import { TILE_NO_SLICE } from '../tiles/noSlice.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import {
  LIGHT_FLAG,
  LIGHT_KIND,
  LIGHT_SETTINGS,
  POINT_FACES,
} from '../../../../sdk-core/src/scene/light/contracts.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../../../../sdk-core/src/scene/core/environment.ts'
import { LIGHT_AIR_MEMBERS } from '../atmosphere/layout.ts'
import { RECT_LIGHT_WGSL } from './rectLightWgsl.ts'
import { LTC_SIZE } from '../../../../sdk-core/src/lighting/ltcTable.ts'
import {
  LIT_PROFILE_ROWS,
  LIT_TRANSMISSION_VEC4S,
} from '../../../../sdk-core/src/lighting/subsurfaceProfile/litRows.ts'
import { ENV_BRDF_TEXELS } from '../../../../sdk-core/src/lighting/environmentBrdf.ts'
import { SKIN_TABLE_TEXELS } from '../../../../sdk-core/src/lighting/skinTable.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { safeRcp } from '../../../../math/src/wgsl/reals.ts'
import {
  isKind,
  lightFlagged,
  localLightReaches,
  radialWindow,
  rangeWindow,
} from './lightReachWgsl.ts'

/** Words of a cell record of the light grid: its count — the high bit set when a light of
 *  its list holds a shadow slot, the cell's one fact the resolve reads before its lights —, then
 *  where its list starts in the view's pool. */
export const TILE_STRIDE_WORDS = 2

/** Words the light grid's buffer holds before its records: the grid's slice map (`gridSlice`, the
 *  three numbers of `../tiles/gridMap.ts`), then one spare, written each image the grid is. */
export const GRID_HEAD_WORDS = 4

/** The light grid (`../tiles/`): cells of pixels, slices of depth, the record of each cell and the
 *  slice a depth falls in. */
export const LIGHT_GRID_WGSL = wgslBlock(
  'LIGHT_GRID_WGSL',
  [],
  `
const TILE_SIZE:u32=${LIGHT_SETTINGS.tileSize}u;
/** The light grid: cells of \`TILE_SIZE\` pixels across, \`GRID_SLICES\` deep along the depth, the last
 *  reaching to infinity. A cell's record (\`TILE_STRIDE\` words) holds its count and where its list of
 *  lights starts in the view's pool, or \`TILE_NO_SLICE\` where no grid is built: the cell walks every light of the scene (\`cellSlice\`). The records follow \`GRID_HEAD\` words, the slice map. */
const GRID_SLICES:u32=${LIGHT_SETTINGS.gridSlices}u;
const GRID_HEAD:u32=${GRID_HEAD_WORDS}u;
/** The lights of a narrow scene (the length its light array is compiled at). */
${wgslConsts({
  TILE_LIGHTS: LIGHT_SETTINGS.tileLights,
  TILE_STRIDE: TILE_STRIDE_WORDS,
})}
/** The count word's high bit: a light of the list holds a shadow slot. */
const TILE_SHADOWED:u32=0x80000000u;
const TILE_NO_SLICE:u32=0x${TILE_NO_SLICE.toString(16)}u;
/** The slice of a depth \`z\` (reverse-Z, 1 at the near plane) by the image's \`map\` (\`near · B\`, \`O\`, \`S\`):
 *  \`log2(depth · B + O) · S\`, the depth being the near plane over \`z\`; the background falls in the
 *  last, and a depth short of the first slice in the first. */
fn gridSlice(z:f32,map:vec3f)->u32{
 let scaled=map.x/max(z,1e-30)+map.y;
 return u32(clamp(log2(max(scaled,1.0))*map.z,0.0,f32(GRID_SLICES-1u)));
}`,
)

/** The constants of the kinds and flags, the light's record and the buffer that holds the lights; `slots` sizes the array. */
const directDeclsText = (slots?: number) => `const POINT_FACES:u32=${POINT_FACES}u;
const KIND_SPOT:f32=${LIGHT_KIND.spot}.0;
const KIND_SUN:f32=${LIGHT_KIND.directional}.0;
const FLAG_CASTS:u32=${LIGHT_FLAG.castsShadow}u;
const FLAG_SHADOWS_FOG:u32=${LIGHT_FLAG.shadowsFog}u;
const FLAG_TRANSMITS:u32=${LIGHT_FLAG.transmission}u;
const LAMP_BIAS:f32=${wgslF32(LIGHT_SETTINGS.lampDistanceBias)};
/** A light's record (\`packages/sdk-core/src/scene/light/fields.ts\`): its place and range, colour
 *  and intensity, direction and outer cone's cosine, kind and flags (\`params.x\`), shadow slice
 *  (\`y\`), the share the fog and clouds scatter (\`z\`), a spot's inner cone's cosine (\`w\`), its shape —
 *  a rectangle's half axes, a lamp's source radius and, in \`y\`, the exponent of a fall-off that is
 *  not the inverse square (0 for it), a sun's disk —, the shares of its diffuse and specular light
 *  (the last two lanes of its shape) and, for a lamp, its tube (its axis times half its length) and
 *  soft radius; a rectangle's shares are the last two lanes of its capsule — and, in \`contactGi\`, the
 *  length of its contact shadows' ray, the intensity of the shadow at a surface that casts contact shadows
 *  (\`y\`) and at one that does not (\`z\`), as \`writeContactShadow\` packs them, and the factor on its indirect lighting (\`w\`). */
struct DirectLight{positionRange:vec4f,colorIntensity:vec4f,directionCone:vec4f,params:vec4f,shape:vec4f,capsule:vec4f,contactGi:vec4f,}
/** The count, the rank plus one of the directional light the forward readers take (\`forwardRank\`,
 *  0 for none; \`SceneLightStore.forwardDirectionalSlot\`) and two reserved words; the environment's irradiance: nine spherical-harmonic coefficients
 *  (\`packages/sdk-core/src/scene/core/environment.ts\`), zero where the host declared none; its fog,
 *  six \`vec4\`: colour and mode, law, range, the sun's lobe, the sky's factor and the sun
 *  (\`FOG_SLOT\`, \`packages/sdk-core/src/scene/core/fog.ts\`); its
 *  atmosphere, the block the CPU writes, the view's block and the haze volume the GPU builds each
 *  image (\`../atmosphere/layout.ts\`), all zero without an atmosphere; the fitted specular lobe a
 *  rectangle is integrated with, written once (\`ltcTable.ts\`); the preintegrated skin table, a word a
 *  texel (\`skinTable.ts\`), written once it is loaded; the preintegrated environment BRDF, a word a
 *  texel (\`environmentBrdf.ts\`), written once; the subsurface profiles' dual specular the lights read, a
 *  \`vec4\` a profile (\`litRows.ts\`), written as the profiles change, and their transmission, the texel and the
 *  samples of the profile, \`LIT_TRANSMISSION_VEC4S\` \`vec4\` a profile; then every light, as many as the
 *  scene holds. */
struct DirectLights{count:u32,forwardRank:u32,pad1:u32,pad2:u32,environment:array<vec4f,${ENVIRONMENT_COEFFICIENTS}>,${LIGHT_AIR_MEMBERS}ltc:array<vec4f,${LTC_SIZE * LTC_SIZE * 2}>,skin:array<u32,${SKIN_TABLE_TEXELS}>,envBrdf:array<u32,${ENV_BRDF_TEXELS}>,profiles:array<vec4f,${LIT_PROFILE_ROWS}>,transmissions:array<vec4f,${LIT_PROFILE_ROWS * LIT_TRANSMISSION_VEC4S}>,items:array<DirectLight${slots ? `,${slots}` : ''}>,}`

/** The tests of a light's kind and flags, what reaches a point, and the shares it gives. */
const DIRECT_QUERIES_TEXT = `/** Each kind's test reads the rank through \`isKind\` (\`isRect\` too, \`rectLightWgsl.ts\`). */
fn isSunKind(kind:f32)->bool{return isKind(kind,KIND_SUN);}
fn isSun(light:DirectLight)->bool{return isSunKind(light.params.x);}
fn isSpot(light:DirectLight)->bool{return isKind(light.params.x,KIND_SPOT);}
/** Whether the light casts shadows, whether its shadow also shadows the volumetric fog and whether it transmits. */
fn castsShadow(light:DirectLight)->bool{return lightFlagged(light.params.x,FLAG_CASTS);}
fn shadowsFog(light:DirectLight)->bool{return lightFlagged(light.params.x,FLAG_SHADOWS_FOG);}
/** Whether the light shines through the subsurface-profile surfaces it shadows. */
fn transmitsLight(light:DirectLight)->bool{return lightFlagged(light.params.x,FLAG_TRANSMITS);}
/** Whether light \`rank\` may give \`P\` energy: the first statement of the one light term, which
 *  reads the light's kind and sphere alone, and its direction and cone only for a spot or a
 *  rectangle, before the rest of its record. A sun always; a local light by \`localLightReaches\`,
 *  the shadows' test too — its sphere, a spot's real cone, a rectangle's face. */
fn lightReaches(rank:u32,P:vec3f)->bool{
 let kind=directLights.items[rank].params.x;
 if(isSunKind(kind)){return true;}
 let sphere=directLights.items[rank].positionRange;
 let spot=isKind(kind,KIND_SPOT);let rect=isKind(kind,KIND_RECT);
 var cone=vec4f(0.0,0.0,0.0,-2.0);
 if(spot||rect){cone=directLights.items[rank].directionCone;cone.w=select(-2.0,cone.w,spot);}
 return localLightReaches(sphere.xyz-P,sphere.w,cone.w,cone.xyz,rect);
}
/** What of a lamp's light reaches \`P\` before its distance weighs it: the unit direction toward it and
 *  the mask, its window times a spot's fade. The window is one at the lamp's centre and zero at its
 *  range: the inverse square's (\`rangeWindow\`), or, where \`shape.y\` holds an exponent, the other
 *  fall-off's (\`radialWindow\`). A spot's fade is the square of a ramp in the cosine, zero at its
 *  outer cone and one at its inner cone. */
fn lampReach(light:DirectLight,P:vec3f)->vec4f{
 let offset=light.positionRange.xyz-P;
 let distance=length(offset);
 let L=offset*safeRcp(distance);
 let exponent=light.shape.y;
 var mask=rangeWindow(distance,light.positionRange.w);
 if(exponent>0.0){mask=radialWindow(distance,light.positionRange.w,exponent);}
 if(isSpot(light)){
  let outer=light.directionCone.w;
  let ramp=saturate((dot(-L,light.directionCone.xyz)-outer)/(light.params.w-outer));
  mask*=ramp*ramp;
 }
 return vec4f(L,mask);
}
/** The share of its diffuse light (\`x\`) and of its specular light (\`y\`) a light gives: a rectangle's
 *  sit in the lanes its tube leaves, every other light's in its shape's last two. */
fn sharesOf(light:DirectLight)->vec2f{return select(light.shape.zw,light.capsule.zw,isRect(light));}
`

/**
 * Structures shared by the light-list pass and deferred resolve: a single GPU-side
 * declaration of the `SceneLight` contract, and a single physical attenuation. Shader
 * bounds come from the published settings, never from hand-written constants. `slots` sizes
 * the light array for a pass that knows the scene holds no more (`../tiles/shader.ts`); by
 * default it holds as many as the buffer bound.
 */
export const directLightWgsl = (slots?: number) =>
  wgslBlock(
    `directLightWgsl(${slots ?? ''})`,
    [
      RECT_LIGHT_WGSL,
      localLightReaches,
      rangeWindow,
      radialWindow,
      safeRcp,
      isKind,
      lightFlagged,
      LIGHT_GRID_WGSL,
    ],
    `${directDeclsText(slots)}
${DIRECT_QUERIES_TEXT}`,
  )
export const DIRECT_LIGHT_WGSL = directLightWgsl()
