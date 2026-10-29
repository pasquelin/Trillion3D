import { fallbackOf } from '../../../materials/graph/program.ts'
import { tileDeclarations } from '../../../materials/virtual/wgsl.ts'
import { MAP_BINDINGS, MAP_SAMPLER_BINDING } from '../../lightFunction/mapBindings.ts'
import { STANDALONE_LIGHT_BYTES } from '../../lightFunction/entries.ts'
import type { GraphSlot } from '../../lightFunction/graphSlot.ts'
import { COLOR_SAMPLE, type AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { standaloneMaskProgramOf, type StandaloneMaskMaterial } from './shadowMaskWgsl.ts'

/**
 * THE LIGHT FUNCTIONS THE ATLAS HOLDS NO SLOT OF, evaluated inside the shadow mask's kernel: a light that wears a light function material but holds no slot
 * of the atlas (the atlas is off, the cache is not among its readers, or a limit left the light out: the lights the cull marks,
 * `TILE_LIGHT_STANDALONE`) has the masks of its light tiles made by a program of its material, the mask's own kernel (`shadowMaskWgsl.ts`)
 * with the material's share in the place of the atlas's function, one program for each distinct material and a dispatch of its own over the
 * tiles of the light's slot of the compacted list (`lightTilesWgsl.ts`, the arguments of the slot). A workgroup is a light tile, a thread a texel.
 * The texel's world point is taken to the light's axes by the light's matrix and so to the material's
 * coordinate, which every texture coordinate set of the material is given: a spot's through the tangent of its outer cone to 0 to
 * 1 across it, a point's by its direction as longitude and latitude, any other light's (a sun's, a rectangle's) by the two axes
 * across the direction as they are — the coordinate is not wrapped. The material's colour there (its emission: the graph's
 * `mgEmissive`, else the colour and map of the material) is taken to its grey (its channels weighed by 0.3333), faded to the light's
 * disabled brightness over the last fifth of its fade distance by the distance from the eye, and held to 0 to 1: the share of the
 * light the texel receives, which multiplies the factor after the atlas's function and before the clouds' shade.
 *
 * A material that reads textures finds their footprint at the points the texels beside it (along x and along y) stand at, the
 * kernel having no derivatives; a texel beside that holds no surface leaves a footprint of nothing there.
 *
 * Bindings: group 0 is the mask's (`SHADOW_MASK_BINDINGS`); in group 1, 0 the light's block and the material's, read at a dynamic offset a
 * light, and where the material reads a texture 1 to 5 the colour atlas of the maps (`MAP_BINDINGS`: three pools, the page table) and the
 * sampler. Eight storage buffers with the page table: the tables, the counters, the compacted light tiles, the masks, the lights, the factors,
 * the traces and the page table.
 */

/** The binding of the light's block and the material's, in group 1. */
export const STANDALONE_MASK_GIVEN_BINDING = 0

/** What a material is evaluated from: its graph compiled for the kernel (`graphStandaloneOf`), or its colour, with a map when it has
 *  one. */
export interface StandaloneMaskProgram {
  readonly graph?: GraphSlot
  readonly mapped: boolean
}

/** The bytes of a plain material's block: its colour and the slot of its map. */
const PLAIN_BYTES = 16

/** Whether the program reads a texture of the colour atlas of the maps. */
export const standaloneMaskMapped = (p: StandaloneMaskProgram) =>
  p.graph ? p.graph.textured : p.mapped

/** The bytes of the block a light and its material take in the kernel's uniform. */
export const standaloneMaskBytes = (p: StandaloneMaskProgram) =>
  STANDALONE_LIGHT_BYTES + (p.graph?.bytes ?? PLAIN_BYTES)

/** The structure of the block (the light's, then the material's) and the colour the material gives at a coordinate. */
function materialText(p: StandaloneMaskProgram) {
  if (!p.graph)
    return {
      given: `struct Given{light:LightBlock,colour:vec3f,map:u32,}`,
      colour: `fn materialColour(uv:vec2f,right:vec2f,below:vec2f)->vec3f{
 var colour=given.colour;
${p.mapped ? ' colour*=colorSample(given.map,uv,right-uv,below-uv,true).rgb;' : ''}
 return colour;
}`,
    }
  const c = p.graph.compiled
  const emission = c.functions.emissive
  const neighbours = p.graph.textured
    ? ` mgNeighbour[0]=ctx;mgNeighbour[1]=ctx;
 mgNeighbour[0].uvs=array<vec2f,8>(${Array(8).fill('right').join(',')});
 mgNeighbour[1].uvs=array<vec2f,8>(${Array(8).fill('below').join(',')});
`
    : ''
  return {
    given: `struct Given{light:LightBlock,head:vec4f,values:${c.values},}`,
    colour: `fn materialColour(uv:vec2f,right:vec2f,below:vec2f)->vec3f{
 var ctx:MgContext;
 ctx.uvs=array<vec2f,8>(${Array(8).fill('uv').join(',')});
 ctx.time=given.head.x;
 ctx.realTime=given.head.y;
${neighbours} return ${emission ? `${emission}(ctx,given.values)` : fallbackOf('emissive').code};
}`,
  }
}

/** The types the material's text reads: the maps' where the material samples them, the light's block and the material's given values, bound in group 1. */
const standaloneDeclarations = (
  maps: string,
  given: string,
) => `${maps}/** A light's block: the rows of the matrix that takes a world point to its axes, then the tangent of a spot's outer cone, the fade
 *  distance and the disabled brightness, then the light's slot and its kind's. */
struct LightBlock{toLight:array<vec4f,4>,shape:vec4f,ids:vec4u,}
${given}
@group(1) @binding(${STANDALONE_MASK_GIVEN_BINDING}) var<uniform> given:Given;`

/** The coordinate of the material at a point, in the light's axes. */
const LIGHT_FUNCTION_UV = `/** The coordinate of the material at the point \`P\` (metres): the point in the light's axes, as the light vector with its x and z swapped
 *  so that xy lie across the light's direction. */
fn lightFunctionUv(P:vec3f)->vec2f{
 let placed=P.x*given.light.toLight[0]+P.y*given.light.toLight[1]+P.z*given.light.toLight[2]+given.light.toLight[3];
 let v=vec3f(placed.z,placed.y,placed.x)/placed.w;
 if(given.light.ids.y==LF_SPOT){return v.xy/(v.z*given.light.shape.x)*0.5+0.5;}
 if(given.light.ids.y==LF_POINT){
  let unit=normalize(v);
  return vec2f((atan2(unit.y,unit.x)+LF_PI)/(2.0*LF_PI),acos(clamp(unit.z,-1.0,1.0))/LF_PI);
 }
 return v.xy;
}`

/** The share of the light a texel receives from the material's colour. */
const LIGHT_FUNCTION_SHARE = `/** The share of the light the texel at \`P\` receives: the grey of the material's colour, faded to the disabled brightness by the
 *  distance from the eye, held to 0 to 1. */
fn lightFunctionShare(colour:vec3f,P:vec3f)->f32{
 let fade=given.light.shape.y;
 let alpha=saturate((fade-length(lp.eye.xyz-P))/(fade*0.2));
 return saturate(mix(given.light.shape.z,dot(colour,vec3f(0.3333)),alpha));
}`

/** The share at the texel `origin` of the page `page`, standing at `P`: the material is read at the neighbours' points where it is sampled from maps (`mapped`). */
const standaloneShareText = (
  mapped: boolean,
) => `fn standaloneShare(page:u32,origin:vec2u,P:vec3f)->f32{
 let uv=lightFunctionUv(P);
 var right=uv;
 var below=uv;
${
  mapped
    ? ` let beside=surfaceTexel(page,origin+vec2u(1u,0u));
 if(beside.valid){right=lightFunctionUv(beside.position/CM_PER_M);}
 let under=surfaceTexel(page,origin+vec2u(0u,1u));
 if(under.valid){below=lightFunctionUv(under.position/CM_PER_M);}
`
    : ''
} let given_colour=materialColour(uv,right,below);
 return lightFunctionShare(select(vec3f(0.0),given_colour,given_colour==given_colour),P);
}`

/** The material's text for the mask's program: what it reads and the share it gives at a texel. */
export function standaloneMaskMaterial(p: StandaloneMaskProgram): StandaloneMaskMaterial {
  const material = materialText(p)
  const mapped = standaloneMaskMapped(p)
  const maps = mapped
    ? `${tileDeclarations(MAP_BINDINGS, 'color', 1)}
@group(1) @binding(${MAP_SAMPLER_BINDING}) var mapsSampler:sampler;
`
    : ''
  return {
    text: `${standaloneDeclarations(maps, material.given)}
${LIGHT_FUNCTION_UV}
${material.colour}
${LIGHT_FUNCTION_SHARE}
${standaloneShareText(mapped)}`,
    declarations: p.graph ? [p.graph.compiled.wgsl] : mapped ? [COLOR_SAMPLE] : [],
  }
}

/** The mask's program in `format` for the light whose function is the material `p`. */
export const standaloneMaskWgsl = (p: StandaloneMaskProgram, format: AtlasFormat) =>
  standaloneMaskProgramOf(format, standaloneMaskMaterial(p))
