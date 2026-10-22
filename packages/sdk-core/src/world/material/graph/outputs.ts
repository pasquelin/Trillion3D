import type { AlphaMode } from '../../../contracts/material.ts'
import { MATERIAL_DOMAINS, type MaterialDomain } from '../../../contracts/volumeMaterial.ts'
import { graphError, type ValueType } from './valueType.ts'

/** The outputs of a graph: one per input of the material, each with the type it is cast to and the
 *  value it takes where nothing is wired (or the output is inactive). */
export const GRAPH_OUTPUTS = {
  baseColor: { type: 'f3', fallback: [0, 0, 0] },
  metallic: { type: 'f1', fallback: [0] },
  specular: { type: 'f1', fallback: [0.5] },
  roughness: { type: 'f1', fallback: [0.5] },
  emissive: { type: 'f3', fallback: [0, 0, 0] },
  opacity: { type: 'f1', fallback: [1] },
  opacityMask: { type: 'f1', fallback: [1] },
  normal: { type: 'f3', fallback: [0, 0, 1] },
  ambientOcclusion: { type: 'f1', fallback: [1] },
  subsurfaceColor: { type: 'f3', fallback: [1, 1, 1] },
} as const satisfies Record<string, { type: ValueType; fallback: readonly number[] }>

/** The name of an output of a graph. */
export type GraphOutput = keyof typeof GRAPH_OUTPUTS

/** How the surface blends (`alphaModeOf`): what decides whether its opacity or its mask is read. */
export type GraphBlend = AlphaMode

/** The outputs each domain reads: a surface all of them; a light function its emission alone; a
 *  volume its albedo (`baseColor`), its extinction (`subsurfaceColor`), its emission and its
 *  occlusion. A wire to any other output is refused. */
export const DOMAIN_OUTPUTS: Record<MaterialDomain, readonly GraphOutput[]> = {
  surface: Object.keys(GRAPH_OUTPUTS) as GraphOutput[],
  lightFunction: ['emissive'],
  volume: ['baseColor', 'subsurfaceColor', 'emissive', 'ambientOcclusion'],
}

/** Whether `domain` accepts a graph (`'surface'`, `'lightFunction'` or `'volume'`). */
export const isGraphDomain = (value: unknown): value is MaterialDomain =>
  (MATERIAL_DOMAINS as readonly unknown[]).includes(value)

/** Whether `name` is the name of an output. */
const isGraphOutput = (name: unknown): name is GraphOutput =>
  typeof name === 'string' && Object.hasOwn(GRAPH_OUTPUTS, name)

/** Refuses an output the domain does not read. */
export function assertDomainOutput(
  domain: MaterialDomain,
  name: string,
): asserts name is GraphOutput {
  if (!isGraphOutput(name)) throw graphError(`'${name}' is not an output`, { output: name })
  if (!DOMAIN_OUTPUTS[domain].includes(name))
    throw graphError(`the ${domain} domain does not read '${name}'`, { domain, output: name })
}

/** Whether a surface reads `name` under `blend`: opacity only translucent, the mask only masked;
 *  an inactive output takes its fallback. The other domains read what they list. */
export function outputActive(domain: MaterialDomain, name: GraphOutput, blend: GraphBlend) {
  if (!DOMAIN_OUTPUTS[domain].includes(name)) return false
  if (domain !== 'surface') return true
  if (name === 'opacity') return blend === 'blend'
  return name !== 'opacityMask' || blend === 'mask'
}
