import { TILE_NO_SLICE } from '../tiles/noSlice.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  POINT_FACES,
} from '../../../../sdk-core/src/scene/light/contracts.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../../../../sdk-core/src/scene/core/environment.ts'
import { RECT_LIGHT_WGSL } from './rectLightWgsl.ts'
import { LTC_SIZE } from '../../../../sdk-core/src/lighting/ltcTable.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { isKind, localLightReaches, rangeWindow } from './lightReachWgsl.ts'

/** Words of a cell record of the light grid: its count — the high bit set when a light of
 *  its list holds a shadow slot, the per-cell fact the moving resolve reads once —, then
 *  where its list starts in the view's pool. */
export const TILE_STRIDE_WORDS = 2

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
    [RECT_LIGHT_WGSL, localLightReaches, rangeWindow, isKind],
    `
const TILE_SIZE:u32=${LIGHT_SETTINGS.tileSize}u;
/** The light grid: cells of \`TILE_SIZE\` pixels across, \`GRID_SLICES\` deep, a doubling of
 *  the view depth every \`SLICES_PER_OCTAVE\` slices from the near plane, the last reaching to
 *  infinity. A cell's record (\`TILE_STRIDE\` words) holds its count and where its list of lights
 *  starts in the view's pool, or \`TILE_NO_SLICE\` when the pool had no room left: that cell walks
 *  every light of the scene (\`cellSlice\`). */
const GRID_SLICES:u32=${LIGHT_SETTINGS.gridSlices}u;
const SLICES_PER_OCTAVE:f32=${LIGHT_SETTINGS.gridSlicesPerOctave}.0;
/** A list's length past which a moving image sums it in full, and the lights of a narrow scene. */
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
}
const POINT_FACES:u32=${POINT_FACES}u;
const SPOT_EDGE:f32=${LIGHT_SETTINGS.spotEdgeSoftness};
const KIND_SPOT:f32=${LIGHT_KIND.spot}.0;
const KIND_SUN:f32=${LIGHT_KIND.directional}.0;
struct DirectLight{positionRange:vec4f,colorIntensity:vec4f,directionCone:vec4f,params:vec4f,shape:vec4f,}
/** The count; the environment's irradiance: nine spherical-harmonic coefficients
 *  (\`packages/sdk-core/src/scene/core/environment.ts\`), zero where the host declared none; its fog,
 *  colour and mode then law (\`packages/sdk-core/src/scene/core/fog.ts\`); the fitted specular lobe
 *  a rectangle is integrated with, written once (\`ltcTable.ts\`); then every light, as many as
 *  the scene holds. */
struct DirectLights{count:u32,pad0:u32,pad1:u32,pad2:u32,environment:array<vec4f,${ENVIRONMENT_COEFFICIENTS}>,fog:array<vec4f,2>,ltc:array<vec4f,${LTC_SIZE * LTC_SIZE * 2}>,items:array<DirectLight${slots ? `,${slots}` : ''}>,}
/** Each kind's test reads the rank through \`isKind\` (\`isRect\` too, \`rectLightWgsl.ts\`). */
fn isSunKind(kind:f32)->bool{return isKind(kind,KIND_SUN);}
fn isSun(light:DirectLight)->bool{return isSunKind(light.params.x);}
fn isSpot(light:DirectLight)->bool{return isKind(light.params.x,KIND_SPOT);}
/** Whether the light may give \`P\` energy, the first statement of the one light term, before the
 *  rest of its record is read: a sun always; a local light by \`localLightReaches\` — its sphere, and a
 *  rectangle's face —, a spot's cone left to its fade. */
fn lightReaches(light:DirectLight,P:vec3f)->bool{
 if(isSun(light)){return true;}
 let sphere=light.positionRange;
 return localLightReaches(sphere.xyz-P,sphere.w,-2.0,light.directionCone.xyz,isRect(light));
}
/** Normalized direction toward the light and attenuation, of a light \`lightReaches\` let through
 *  (its window is zero at and past its range anyway). A punctual light's: a rectangle has no one
 *  direction (\`rectIrradiance\`). */
fn directIncidence(light:DirectLight,P:vec3f)->vec4f{
 // A directional light has neither position nor range: the same irradiance at every point, never
 // attenuated by distance. Its direction is that of propagation, so incidence is the opposite.
 // The contract has already normalized it.
 if(isSun(light)){return vec4f(-light.directionCone.xyz,1.0);}
 let offset=light.positionRange.xyz-P;
 let range=light.positionRange.w;
 let distance=length(offset);
 let L=offset/max(distance,1e-6);
 // Physical inverse square, windowed by range: energy cancels exactly at range.
 var attenuation=rangeWindow(distance,range)/max(distance*distance,1e-4);
 if(isSpot(light)){
  let cosine=dot(-L,light.directionCone.xyz);
  let edge=light.directionCone.w;
  // A declared penumbra widens the fade inward to its inner cone; never narrower than the edge.
  attenuation*=smoothstep(edge,max(light.params.w,edge+SPOT_EDGE),cosine);
 }
 return vec4f(L,attenuation);
}
`,
  )
export const DIRECT_LIGHT_WGSL = directLightWgsl()
