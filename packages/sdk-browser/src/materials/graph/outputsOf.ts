import type { GraphOutput } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import type { CompiledGraph } from './compile.ts'
import { fallbackOf } from './program.ts'

/**
 * WHAT A PASS TAKES OF A GRAPH'S OUTPUTS, the one rule of every pass that shades a surface with one
 * (the opaque resolve, `visibility/shader/shadeGraphWgsl.ts`, and the transparent pass,
 * `blend/graphWgsl.ts`): each output a shader holds to its range, and the lobes it hands the lighting.
 * `call` gives the code of an output at the point being shaded (`outputCall`): its function's call,
 * or the fallback where nothing is wired or the output is inactive.
 */
export type OutputCall = (name: GraphOutput) => string

/** The code that calls the output `name` of `g` with `args` (the context and the values), or its fallback. */
export const outputCall =
  (g: CompiledGraph, args: string): OutputCall =>
  (name) => {
    const fn = g.functions[name]
    return fn ? `${fn}(${args})` : fallbackOf(name).code
  }

/**
 * The outputs of a surface, held as a shader holds them: the base colour, the opacity, the
 * metalness, the roughness, the occlusion and the specular saturated; the emission not below zero
 * unless the material allows it (`negativeEmissive`; `emission`, whether the surface is lit or not). A surface that is not lit shows
 * its emission as its colour and gives none besides.
 */
export function heldOutputs(g: CompiledGraph, call: OutputCall) {
  const emission = g.negativeEmissive ? call('emissive') : `max(${call('emissive')},vec3f(0.0))`
  const saturated = (name: GraphOutput) => `saturate(${call(name)})`
  return {
    emission,
    rgb: g.lit ? saturated('baseColor') : emission,
    emissive: g.lit ? emission : 'vec3f(0.0)',
    opacity: saturated('opacity'),
    metallic: saturated('metallic'),
    roughness: saturated('roughness'),
    occlusion: saturated('ambientOcclusion'),
    specular: saturated('specular'),
  }
}

/**
 * The lobes a graph wires, as the values of a lobe record (`physicalRecord`) and the tangent of its
 * anisotropy: the strength is the anisotropy's magnitude held to one, `law` says which axis the
 * highlight is stretched along (1 the tangent, 2 the bitangent, where the anisotropy is negative),
 * the coat is the clear coat's, and zero where `clearCoat` is not wired, its roughness held to the
 * floor, and the cloth's fuzz colour and amount (`sheen`). None where the graph wires none of the
 * three. `on` holds the tests of the pixel's shading model that keep its coat and its cloth
 * (`shadingModel`): each is the model's own, so a pixel of another has none. `prelude` declares `mgA`, the anisotropy, which `law`
 * reads. `wired` says which outputs the shaded point has: the graph's own by default, a closure past the first's its slab's.
 */
export function graphLobes(
  g: CompiledGraph,
  call: OutputCall,
  on: { coat?: string; cloth?: string } = {},
  wired: (name: GraphOutput) => boolean = (name) => !!g.functions[name],
) {
  const { coat: coatOn, cloth: clothOn } = on
  const aniso = wired('anisotropy')
  const coat = wired('clearCoat')
  const cloth = wired('cloth')
  const strength = `saturate(${coat ? call('clearCoat') : '0.0'})`
  if (!aniso && !coat && !cloth) return undefined
  // The cloth: the fuzz colour is the `subsurfaceColor` output, held to its range, the amount the
  // `cloth` output; a pixel of another model, where the graph picks one, has none.
  const fuzz = wired('subsurfaceColor')
    ? `clamp(${call('subsurfaceColor')},vec3f(0.0),vec3f(1.0))`
    : 'vec3f(1.0)'
  const amount = `saturate(${call('cloth')})`
  return {
    sheen: cloth
      ? `vec4f(${fuzz},${clothOn ? `select(0.0,${amount},${clothOn})` : amount})`
      : 'vec4f(0.0)',
    prelude: `let mgA=${aniso ? `clamp(${call('anisotropy')},-1.0,1.0)` : '0.0'};`,
    lobes: `vec4f(abs(mgA),0.0,${coat ? `${coatOn ? `select(0.0,${strength},${coatOn})` : strength}` : '0.0'},${coat ? `ormRoughness(1.0,${call('clearCoatRoughness')})` : '0.0'})`,
    law: 'select(1u,2u,mgA<0.0)',
    tangent: aniso ? call('tangent') : 'vec3f(1.0,0.0,0.0)',
  }
}
