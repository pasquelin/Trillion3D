import { FULLSCREEN_XY } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  SHADOW_TILE_POOL_WGSL,
  colorSampleWgsl,
  tileDeclarations,
} from '../../materials/virtual/wgsl.ts'
import { MAP_BINDINGS, MAP_SAMPLER_BINDING } from './mapBindings.ts'

/** What an atlas texel holds: the grey of the colour, or the colour. */
export type AtlasFormat = 'grey' | 'colour'

/** The end of a slot's program: the colour in `name` made finite, kept as its square root — its
 *  grey or its three channels —, written as the bits of floats (`layout.ts`). */
export const packSlotColour = (
  format: AtlasFormat,
  name: string,
) => `let colour=select(vec3f(0.0),${name},${name}==${name});
 ${
   format === 'grey'
     ? 'let grey=sqrt(max(dot(colour,vec3f(0.3333)),0.0));\n return bitcast<vec4u>(vec4f(grey,grey,grey,0.0));'
     : 'return bitcast<vec4u>(vec4f(sqrt(max(colour,vec3f(0.0))),0.0));'
 }`

/** The colour atlas read at the pass's own footprint: no level offset, as the shadow passes read it. */
const COLOR_SAMPLE = colorSampleWgsl(SHADOW_TILE_POOL_WGSL)

/**
 * The program that draws one slot of the atlas: the colour the material gives (`given.colour`, its
 * emissive colour times its intensity) times, for a material that wears a map (`mapped`), the map
 * read at the slot's coordinate `uv` as a surface's emission map is (`colorSample`, with the map's
 * own wrap, filters and transform), at each texel of the slot of `slot` texels a side. The texel's
 * centre maps to `uv` from 0 at the slot's first to 1 at its last. The result is kept as its square
 * root, the atlas's gamma compression: the grey of the colour's three channels' mean, or the three
 * channels, written as the bits of floats (`layout.ts`). Draw with the viewport on the slot: the
 * corner is read off the pixel. The pass's uniform is bound with an offset a slot.
 */
export const lightFunctionRenderWgsl = (slot: number, format: AtlasFormat, mapped: boolean) =>
  wgslProgram(
    `struct Given{colour:vec3f,map:u32,}
@group(0) @binding(0) var<uniform> given:Given;
${mapped ? `${tileDeclarations(MAP_BINDINGS, 'color')}\n@group(0) @binding(${MAP_SAMPLER_BINDING}) var mapsSampler:sampler;` : ''}
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(${FULLSCREEN_XY},0.0,1.0);}
@fragment fn slotTexel(@builtin(position) at:vec4f)->@location(0) vec4u{
 let size=${wgslF32(slot)};
 let corner=floor(at.xy/size)*size;
 let uv=(at.xy-corner-vec2f(0.5))/(size-1.0);
 var given_colour=given.colour;
 ${mapped ? 'let texelStep=1.0/(size-1.0);\n given_colour*=colorSample(given.map,uv,vec2f(texelStep,0.0),vec2f(0.0,texelStep),true).rgb;' : ''}
 ${packSlotColour(format, 'given_colour')}
}`,
    mapped ? [COLOR_SAMPLE] : [],
  )
