import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { tileDeclarations } from '../../../materials/virtual/wgsl.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import { MAP_BINDINGS, MAP_SAMPLER_BINDING } from '../../lightFunction/mapBindings.ts'
import { COLOR_SAMPLE } from '../../lightFunction/renderWgsl.ts'
import { LIGHT_FUNCTION_KINDS_WGSL } from '../../lightFunction/readWgsl.ts'
import {
  LIGHT_FUNCTION_UV,
  materialText,
  standaloneDeclarations,
  standaloneMaskMapped,
  type StandaloneMaskProgram,
} from '../../surfaceCache/lighting/standaloneMaskWgsl.ts'
import { SUN_FOG_VIEW_BINDING, SUN_FOG_VIEW_WGSL } from './viewWgsl.ts'

/**
 * THE SUN'S LIGHT FUNCTION DRAWN FOR THE VOLUMETRIC FOG: a texel of the texture is a point of the plane through the centre of the
 * sphere the texture covers, across the sun's direction (`SunFogView`: the texel's place over the side, from -1 to 1 along the
 * texture's right and up axes, up being down the rows), seen in the sun's own axes by the same read the surface cache's lights take
 * (`lightFunctionUv`, a sun's axes as they are: the coordinate is not wrapped, the material's own wrap and filters apply) and given the
 * material's colour there (`materialColour`, its graph's emission, else its colour and map). The texel holds the share of the sun the
 * point receives: the colour's grey, held to 0 to 1. It is not faded here: the fade by the distance from the eye is applied by the
 * volume (`readWgsl.ts`) at the cell that reads the texel, whose distance is not that of the texel's point on the plane. A material that
 * reads textures finds its footprint at the texels beside this one, as the surface cache's kernel does. Bindings, all in group 0: 0 the sun's block and the material's (`Given`), where the material reads a
 * texture the colour atlas of the maps and its sampler (`MAP_BINDINGS`), and `SUN_FOG_VIEW_BINDING` the view block.
 */
export const sunFogRenderWgsl = (p: StandaloneMaskProgram) => {
  const material = materialText(p)
  const mapped = standaloneMaskMapped(p)
  const maps = mapped
    ? `${tileDeclarations(MAP_BINDINGS, 'color', 0)}
@group(0) @binding(${MAP_SAMPLER_BINDING}) var mapsSampler:sampler;
`
    : ''
  return wgslProgram(
    `${standaloneDeclarations(maps, material.given, 0)}
@group(0) @binding(${SUN_FOG_VIEW_BINDING}) var<uniform> lp:SunFogView;
${LIGHT_FUNCTION_UV}
${material.colour}
// The point of the plane the texel at the pixel coordinates stands for.
fn sunTexelPoint(at:vec2f)->vec3f{
 let across=(at/lp.right.w-vec2f(0.5))*vec2f(2.0,-2.0);
 return lp.centre.xyz+lp.centre.w*(across.x*lp.right.xyz+across.y*lp.up.xyz);
}
@fragment fn sunTexel(@builtin(position) at:vec4f)->@location(0) vec4f{
 let P=sunTexelPoint(at.xy);
 let uv=lightFunctionUv(P);
 let given_colour=materialColour(uv,lightFunctionUv(sunTexelPoint(at.xy+vec2f(1.0,0.0))),lightFunctionUv(sunTexelPoint(at.xy+vec2f(0.0,1.0))));
 let grey=dot(select(vec3f(0.0),given_colour,given_colour==given_colour),vec3f(0.3333));
 return vec4f(saturate(grey),0.0,0.0,1.0);
}`,
    [
      FULLSCREEN_VERTEX,
      LIGHT_FUNCTION_KINDS_WGSL,
      SUN_FOG_VIEW_WGSL,
      ...(p.graph ? [p.graph.compiled.wgsl] : mapped ? [COLOR_SAMPLE] : []),
    ],
  )
}
