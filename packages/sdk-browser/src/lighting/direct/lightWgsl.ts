import { LIGHT_KIND, LIGHT_SETTINGS, POINT_FACES } from '../../../../sdk-core/src/index.ts';
import { ENVIRONMENT_COEFFICIENTS } from '../../../../sdk-core/src/scene/core/environment.ts';
import { RECT_LIGHT_WGSL } from './rectLightWgsl.ts';
import { LTC_SIZE } from '../../../../sdk-core/src/lighting/ltcTable.ts';

/** Words of a cell record of the light grid (#1369): its count — the high bit set when a light of
 *  its list holds a shadow slot, the per-cell fact the moving resolve reads once (#1249) —, then
 *  where its list starts in the view's pool. */
export const TILE_STRIDE_WORDS = 2;

/**
 * Structures shared by the light-list pass and deferred resolve: a single GPU-side
 * declaration of the `SceneLight` contract, and a single physical attenuation. Shader
 * bounds come from the published settings, never from hand-written constants. `slots` sizes
 * the light array for a pass that knows the scene holds no more (`../tiles/shader.ts`); by
 * default it holds as many as the buffer bound.
 */
export const directLightWgsl = (slots?: number) => `
const TILE_SIZE:u32=${LIGHT_SETTINGS.tileSize}u;
/** The light grid (#1369): cells of \`TILE_SIZE\` pixels across, \`GRID_SLICES\` deep, a doubling of
 *  the view depth every \`SLICES_PER_OCTAVE\` slices from the near plane, the last reaching to
 *  infinity. A cell's record (\`TILE_STRIDE\` words) holds its count and where its list of lights
 *  starts in the view's pool, or \`TILE_NO_SLICE\` when the pool had no room left: that cell walks
 *  every light of the scene (\`cellSlice\`). */
const GRID_SLICES:u32=${LIGHT_SETTINGS.gridSlices}u;
const SLICES_PER_OCTAVE:f32=${LIGHT_SETTINGS.gridSlicesPerOctave}.0;
/** A list's length past which a moving image sums it in full, and the lights of a narrow scene. */
const TILE_LIGHTS:u32=${LIGHT_SETTINGS.tileLights}u;
const TILE_STRIDE:u32=${TILE_STRIDE_WORDS}u;
/** The count word's high bit: a light of the list holds a shadow slot (#1249). */
const TILE_SHADOWED:u32=0x80000000u;
const TILE_NO_SLICE:u32=0xffffffffu;
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
/** The type rank is a float in the buffer: a single place knows how to reread it. */
fn isSunKind(kind:f32)->bool{return abs(kind-KIND_SUN)<0.5;}
fn isSun(light:DirectLight)->bool{return isSunKind(light.params.x);}
/** The range window at \`distance\` from a light's centre: one at the centre, zero at its range. */
fn rangeWindow(distance:f32,range:f32)->f32{
 let ratio=distance/range;
 return pow(clamp(1.0-ratio*ratio*ratio*ratio,0.0,1.0),2.0);
}
${RECT_LIGHT_WGSL}
/** Normalized direction toward the light and attenuation; w at zero when the point is out of
 *  range. A punctual light's: a rectangle has no one direction (\`rectIrradiance\`). */
fn directIncidence(light:DirectLight,P:vec3f)->vec4f{
 // A directional light has neither position nor range: the same irradiance at every point, never
 // attenuated by distance. Its direction is that of propagation, so incidence is the opposite.
 // The contract has already normalized it.
 if(isSun(light)){return vec4f(-light.directionCone.xyz,1.0);}
 let offset=light.positionRange.xyz-P;
 let distance=length(offset);
 let range=light.positionRange.w;
 if(distance>=range){return vec4f(0.0);}
 let L=offset/max(distance,1e-6);
 // Physical inverse square, windowed by range: energy cancels exactly at range.
 var attenuation=rangeWindow(distance,range)/max(distance*distance,1e-4);
 if(abs(light.params.x-KIND_SPOT)<0.5){
  let cosine=dot(-L,light.directionCone.xyz);
  let edge=light.directionCone.w;
  // A declared penumbra widens the fade inward to its inner cone; never narrower than the edge.
  attenuation*=smoothstep(edge,max(light.params.w,edge+SPOT_EDGE),cosine);
 }
 return vec4f(L,attenuation);
}
/** The unshadowed resolve's range reject (#1249, \`sliceLightingWgsl\`): a light is skipped past
 *  this many times its squared range, far above the f32 roundings of \`length\`, so
 *  \`directIncidence\` and \`rectView\` would have given it zero there. */
const RANGE_REJECT:f32=1.0001;
`;
export const DIRECT_LIGHT_WGSL = directLightWgsl();
