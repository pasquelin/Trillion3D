import { TILE_NO_SLICE } from '../tiles/noSlice.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  POINT_FACES,
} from '../../../../sdk-core/src/scene/light/contracts.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../../../../sdk-core/src/scene/core/environment.ts'
import { LIGHT_AIR_MEMBERS } from '../atmosphere/layout.ts'
import { RECT_LIGHT_WGSL } from './rectLightWgsl.ts'
import { LTC_SIZE } from '../../../../sdk-core/src/lighting/ltcTable.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { isKind, localLightReaches, rangeWindow } from './lightReachWgsl.ts'

/** Words of a cell record of the light grid: its count — the high bit set when a light of
 *  its list holds a shadow slot, the cell's one fact the resolve reads before its lights —, then
 *  where its list starts in the view's pool. */
export const TILE_STRIDE_WORDS = 2

/** The light grid (`../tiles/`): cells of pixels, slices of depth, the record of each cell and the
 *  cell a pixel at a depth falls in. */
const LIGHT_GRID_WGSL = wgslBlock(
  'LIGHT_GRID_WGSL',
  [],
  `
const TILE_SIZE:u32=${LIGHT_SETTINGS.tileSize}u;
/** The light grid: cells of \`TILE_SIZE\` pixels across, \`GRID_SLICES\` deep, a doubling of
 *  the view depth every \`SLICES_PER_OCTAVE\` slices from the near plane, the last reaching to
 *  infinity. A cell's record (\`TILE_STRIDE\` words) holds its count and where its list of lights
 *  starts in the view's pool, or \`TILE_NO_SLICE\` when the pool had no room left: that cell walks
 *  every light of the scene (\`cellSlice\`). */
const GRID_SLICES:u32=${LIGHT_SETTINGS.gridSlices}u;
const SLICES_PER_OCTAVE:f32=${LIGHT_SETTINGS.gridSlicesPerOctave}.0;
/** The lights of a narrow scene (the length its light array is compiled at). */
${wgslConsts({
  TILE_LIGHTS: LIGHT_SETTINGS.tileLights,
  TILE_STRIDE: TILE_STRIDE_WORDS,
})}
/** The count word's high bit: a light of the list holds a shadow slot. */
const TILE_SHADOWED:u32=0x80000000u;
const TILE_NO_SLICE:u32=0x${TILE_NO_SLICE.toString(16)}u;
/** The slice of a depth \`z\` (reverse-Z, 1 at the near plane): the doublings of its view depth
 *  past the near plane, \`SLICES_PER_OCTAVE\` a doubling; the background falls in the last. */
fn gridSlice(z:f32)->u32{return u32(clamp(-log2(max(z,1e-30))*SLICES_PER_OCTAVE,0.0,f32(GRID_SLICES-1u)));}
/** The first word of the record of the cell holding a pixel at depth \`z\`, \`cells\` the grid's
 *  columns across and down; \`TILE_NO_SLICE\` past the grid. */
fn gridCell(pixel:vec2f,z:f32,cells:vec2u)->u32{
 let column=vec2u(pixel)/TILE_SIZE;
 if(column.x>=cells.x||column.y>=cells.y){return TILE_NO_SLICE;}
 return ((column.y*cells.x+column.x)*GRID_SLICES+gridSlice(z))*TILE_STRIDE;
}`,
)

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
    [RECT_LIGHT_WGSL, localLightReaches, rangeWindow, isKind, LIGHT_GRID_WGSL],
    `const POINT_FACES:u32=${POINT_FACES}u;
const SPOT_EDGE:f32=${LIGHT_SETTINGS.spotEdgeSoftness};
const KIND_SPOT:f32=${LIGHT_KIND.spot}.0;
const KIND_SUN:f32=${LIGHT_KIND.directional}.0;
const LAMP_BIAS:f32=${wgslF32(LIGHT_SETTINGS.lampDistanceBias)};
/** A light's record (\`packages/sdk-core/src/scene/light/fields.ts\`): its place and range, colour
 *  and intensity, direction and cone, kind and shadow, its shape — a rectangle's half axes, a
 *  lamp's source radius, a sun's disk — and, for a lamp, its tube (its axis times half its length)
 *  and soft radius. */
struct DirectLight{positionRange:vec4f,colorIntensity:vec4f,directionCone:vec4f,params:vec4f,shape:vec4f,capsule:vec4f,}
/** The count; the environment's irradiance: nine spherical-harmonic coefficients
 *  (\`packages/sdk-core/src/scene/core/environment.ts\`), zero where the host declared none; its fog,
 *  six \`vec4\`: colour and mode, law, range, the sun's lobe, the sky's factor and the sun
 *  (\`FOG_SLOT\`, \`packages/sdk-core/src/scene/core/fog.ts\`); the sky's block, the
 *  irradiance of the sky light and the radiance a ray that leaves the scene reaches
 *  (\`packages/sdk-core/src/scene/core/environmentSky.ts\`), zero where the scene shows no sky; its
 *  atmosphere, the block the CPU writes, the view's block and the haze volume the GPU builds each
 *  image, then the sky by direction it builds when the sun or the air changes
 *  (\`../atmosphere/layout.ts\`), all zero without an atmosphere; the fitted specular lobe a
 *  rectangle is integrated with, written once (\`ltcTable.ts\`); then every light, as many as the
 *  scene holds. */
struct DirectLights{count:u32,pad0:u32,pad1:u32,pad2:u32,environment:array<vec4f,${ENVIRONMENT_COEFFICIENTS}>,${LIGHT_AIR_MEMBERS}ltc:array<vec4f,${LTC_SIZE * LTC_SIZE * 2}>,items:array<DirectLight${slots ? `,${slots}` : ''}>,}
/** Each kind's test reads the rank through \`isKind\` (\`isRect\` too, \`rectLightWgsl.ts\`). */
fn isSunKind(kind:f32)->bool{return isKind(kind,KIND_SUN);}
fn isSun(light:DirectLight)->bool{return isSunKind(light.params.x);}
fn isSpot(light:DirectLight)->bool{return isKind(light.params.x,KIND_SPOT);}
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
 *  the mask, its range window (zero at and past its range) times a spot's fade outside its cone. */
fn lampReach(light:DirectLight,P:vec3f)->vec4f{
 let offset=light.positionRange.xyz-P;
 let distance=length(offset);
 let L=offset/max(distance,1e-6);
 var mask=rangeWindow(distance,light.positionRange.w);
 if(isSpot(light)){
  let cosine=dot(-L,light.directionCone.xyz);
  let edge=light.directionCone.w;
  // A declared penumbra widens the fade inward to its inner cone; never narrower than the edge.
  mask*=smoothstep(edge,max(light.params.w,edge+SPOT_EDGE),cosine);
 }
 return vec4f(L,mask);
}
/** Unit direction toward the light and attenuation, of a light \`lightReaches\` let through (its
 *  window is zero at and past its range, its fade outside its cone). A punctual light's: a
 *  rectangle has no one direction (\`rectIrradiance\`). The direction is unit as it comes — the
 *  sun's by its contract, a lamp's by its distance —: no term normalises it again. */
fn directIncidence(light:DirectLight,P:vec3f)->vec4f{
 // A directional light has neither position nor range: the same irradiance at every point, never
 // attenuated by distance. Its direction is that of propagation, so incidence is the opposite.
 // The contract has already normalized it.
 if(isSun(light)){return vec4f(-light.directionCone.xyz,1.0);}
 let reach=lampReach(light,P);
 let offset=light.positionRange.xyz-P;
 // Physical inverse square, its squared distance a square centimetre longer, windowed by range:
 // energy cancels exactly at range, and stays finite at the lamp.
 return vec4f(reach.xyz,reach.w/(dot(offset,offset)+LAMP_BIAS));
}
`,
  )
export const DIRECT_LIGHT_WGSL = directLightWgsl()
