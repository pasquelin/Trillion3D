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
import { sampleRequest } from './nodesTexture.ts'
import { State, type Derivatives, type SampleRead, type Uses } from './state.ts'
import { translateNode } from './translate.ts'
import { constantOf, forceCast, wgslType } from './value.ts'

/** The context a compiled graph reads: what the host knows of the point being shaded. */
export const GRAPH_CONTEXT = wgslStruct(
  'MgContext',
  [],
  'struct MgContext{uvs:array<vec2f,8>,world:vec3f,eye:vec3f,origin:vec3f,vertexNormal:vec3f,pixelNormal:vec3f,time:f32,realTime:f32,}',
)

/** The contexts a footprint's neighbours are read in (`NEIGHBOURS`): the point a pixel to the right
 *  and the point a pixel below, which the host fills before it calls an output. */
const NEIGHBOURS_WGSL = wgslBlock(
  'MG_NEIGHBOURS_WGSL',
  [GRAPH_CONTEXT],
  'var<private> mgNeighbour:array<MgContext,2>;',
)

/** The WGSL function name of the output `name`: `mgEmissive`, `mgBaseColor`… and `suffix`. */
export const outputFunction = (name: GraphOutput, suffix = '') =>
  `mg${name[0].toUpperCase()}${name.slice(1)}${suffix}`

/** The name of the structure of the values a graph reads, and of the function that asks the tiles
 *  its textures take. */
export const valuesStruct = (suffix = '') => `MgValues${suffix}`
export const askFunction = (suffix = '') => `mgAsk${suffix}`

/** What one compilation is given: the graph, its domain, the slots of its values, how a texture
 *  read finds its footprint, and the suffix that names its declarations apart. */
export interface Compilation {
  readonly graph: MaterialGraph
  readonly domain: MaterialDomain
  readonly slots: Slots
  readonly derivatives: Derivatives
  readonly suffix: string
}

/** One output compiled: its function and what it reads. */
export interface CompiledOutput {
  readonly name: GraphOutput
  readonly text: string
  readonly uses: Uses
  readonly samples: readonly SampleRead[]
}

/** The function of one output: the lines the graph needs, then the value cast to the output's type. */
export function compileOutput(c: Compilation, name: GraphOutput): CompiledOutput {
  const pin = c.graph.outputs[name]
  if (!pin) throw graphError(`the ${name} output is not wired`)
  const state = new State({ ...c, output: name, translate: translateNode })
  const spec = GRAPH_OUTPUTS[name]
  const value = forceCast(state.value(pin), spec.type)
  if (value.type === 'texture') throw graphError(`a texture cannot be wired to ${name}`)
  const out = wgslType(spec.type)
  const body = [...state.e.lines, `return ${value.code};`].join('\n ')
  const head = `fn ${outputFunction(name, c.suffix)}(ctx:MgContext,g:${valuesStruct(c.suffix)})->${out}`
  return { name, text: `${head}{\n ${body}\n}`, uses: state.uses, samples: state.samples }
}

/**
 * The function that asks the tile each texture read of the graph takes (`mgAsk`): for the read
 * `p.sel` names, the very texel it reads — its coordinate and footprint evaluated again from the
 * graph —, as the request of a map is made (`colorRequestIndex`), or zero past the last read.
 */
export function compileAsk(c: Compilation, reads: readonly SampleRead[]) {
  const branches = reads.map((read, at) => {
    const state = new State({ ...c, output: read.output, translate: translateNode })
    const request = sampleRequest(state, read.node)
    return `if(p.sel==${at}u){\n  ${[...state.e.lines, `return ${request};`].join('\n  ')}\n }`
  })
  const head = `fn ${askFunction(c.suffix)}(ctx:MgContext,g:${valuesStruct(c.suffix)},p:RequestPick,missing:bool)->u32`
  return `${head}{\n ${branches.join('\n ')}\n return 0u;\n}`
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
 *  a texture (it needs the atlas's declarations): shared by every graph of a program. */
const sampleLevelWgsl = (sample: WgslDecl) =>
  wgslBlock(
    'MG_SAMPLE_LEVEL_WGSL',
    [sample],
    `fn mgSampleLevel(slot:u32,uv:vec2f,level:f32)->vec4f{
 let step=exp2(level)/colorSlot(slot).size;
 return colorSample(slot,uv,vec2f(step.x,0.0),vec2f(0.0,step.y),true);
}`,
  )

/** What a graph's block is made of: its name, the values it reads, the functions of its outputs and
 *  of the tile requests, the atlas read where it reads a texture, and the declarations of the
 *  requests where it asks them. */
export interface BlockParts {
  readonly hash: string
  readonly suffix: string
  readonly slots: Slots
  readonly derivatives: Derivatives
  readonly functions: readonly CompiledOutput[]
  readonly ask?: { text: string; request: WgslDecl }
  readonly sample?: WgslDecl
}

/** The block that declares the values a graph reads, the functions of its outputs and, when it reads
 *  a texture, the helper that reads a level of the atlas, on the atlas read `sample`
 *  (`colorSample`); in a program that finds footprints by neighbours, their contexts. */
export function programBlock(parts: BlockParts): WgslDecl {
  const { hash, suffix, slots, functions, ask } = parts
  const text = `struct ${valuesStruct(suffix)}{v:array<vec4f,${Math.max(slots.vectors.length, 1)}>,t:array<vec4u,${slots.textureRows}>,}
${functions.map((f) => f.text).join('\n')}${ask ? `\n${ask.text}` : ''}`
  return wgslBlock(`materialGraph(${hash})`, dependencies(parts), text)
}

/** The declarations the block of a graph lists. */
function dependencies({ derivatives, ask, sample }: BlockParts) {
  return [
    GRAPH_CONTEXT,
    ...(derivatives === 'neighbours' ? [NEIGHBOURS_WGSL] : []),
    ...(sample ? [sample, sampleLevelWgsl(sample)] : []),
    ...(ask ? [ask.request] : []),
  ]
}
