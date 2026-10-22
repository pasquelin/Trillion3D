import { wgslBlock, wgslStruct, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import type { MaterialDomain } from '../../../../sdk-core/src/contracts/volumeMaterial.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import {
  GRAPH_OUTPUTS,
  outputActive,
  type GraphBlend,
  type GraphOutput,
} from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { Slots } from './layout.ts'
import { State, type Derivatives, type Uses } from './state.ts'
import { translateNode } from './translate.ts'
import { constantOf, forceCast, wgslType } from './value.ts'

/** The context a compiled graph reads: what the host knows of the point being shaded. */
const GRAPH_CONTEXT = wgslStruct(
  'MgContext',
  [],
  'struct MgContext{uvs:array<vec2f,8>,world:vec3f,eye:vec3f,origin:vec3f,vertexNormal:vec3f,pixelNormal:vec3f,time:f32,realTime:f32,ddx:vec2f,ddy:vec2f,}',
)

/** The WGSL function name of the output `name`: `mgEmissive`, `mgBaseColor`… */
export const outputFunction = (name: GraphOutput) => `mg${name[0].toUpperCase()}${name.slice(1)}`

/** One output compiled: its function and what it reads. */
export interface CompiledOutput {
  readonly name: GraphOutput
  readonly text: string
  readonly uses: Uses
}

/** The function of one output: the lines the graph needs, then the value cast to the output's type. */
export function compileOutput(
  graph: MaterialGraph,
  domain: MaterialDomain,
  name: GraphOutput,
  slots: Slots,
  derivatives: Derivatives,
): CompiledOutput {
  const pin = graph.outputs[name]
  if (!pin) throw graphError(`the ${name} output is not wired`)
  const state = new State({
    graph,
    domain,
    output: name,
    slots,
    derivatives,
    translate: translateNode,
  })
  const spec = GRAPH_OUTPUTS[name]
  const value = forceCast(state.value(pin), spec.type)
  if (value.type === 'texture') throw graphError(`a texture cannot be wired to ${name}`)
  const out = wgslType(spec.type)
  const body = [...state.e.lines, `return ${value.code};`].join('\n ')
  const text = `fn ${outputFunction(name)}(ctx:MgContext,g:MgValues)->${out}{\n ${body}\n}`
  return { name, text, uses: state.uses }
}

/** The constant an inactive or unwired output takes. */
export const fallbackOf = (name: GraphOutput) => {
  const spec = GRAPH_OUTPUTS[name]
  return constantOf(spec.type, spec.fallback)
}

/** Whether `name` is compiled for `domain` under `blend`: wired and read. */
export const isCompiled = (
  graph: MaterialGraph,
  domain: MaterialDomain,
  name: GraphOutput,
  blend: GraphBlend,
) => !!graph.outputs[name] && outputActive(domain, name, blend)

/** The helper that reads an absolute level of the colour atlas, written only for a graph that reads
 *  a texture (it needs the atlas's declarations). */
const SAMPLE_LEVEL_WGSL = `fn mgSampleLevel(slot:u32,uv:vec2f,level:f32)->vec4f{
 let step=exp2(level)/colorSlot(slot).size;
 return colorSample(slot,uv,vec2f(step.x,0.0),vec2f(0.0,step.y),true);
}`

/** The block that declares the values a graph reads, the functions of its outputs and, when it reads
 *  a texture, the helper that reads a level of the atlas, on the atlas read `sample`
 *  (`colorSample`). */
export function programBlock(
  hash: string,
  slots: Slots,
  functions: readonly CompiledOutput[],
  sample: WgslDecl | undefined,
): WgslDecl {
  const text = `struct MgValues{v:array<vec4f,${Math.max(slots.vectors.length, 1)}>,t:array<vec4u,${slots.textureRows}>,}
${sample ? SAMPLE_LEVEL_WGSL : ''}
${functions.map((f) => f.text).join('\n')}`
  return wgslBlock(
    `materialGraph(${hash})`,
    sample ? [GRAPH_CONTEXT, sample] : [GRAPH_CONTEXT],
    text,
  )
}
