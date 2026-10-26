import { wgslBlock, wgslFn, wgslStruct, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import type { MaterialDomain } from '../../../../sdk-core/src/contracts/volumeMaterial.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import {
  GRAPH_OUTPUTS,
  isThinTranslucentGraph,
  isWaterGraph,
  outputActive,
  type GraphOutput,
  type GraphReading,
} from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { Slots } from './layout.ts'
import { NOISE_WGSL } from './noiseWgsl.ts'
import { sampleRequest } from './nodesTexture.ts'
import { State, type Derivatives, type SampleRead, type Uses } from './state.ts'
import { translateNode } from './translate.ts'
import { constantOf, forceCast, wgslType } from './value.ts'

/** The context a compiled graph reads: what the host knows of the point being shaded. */
export const GRAPH_CONTEXT = wgslStruct(
  'MgContext',
  [],
  'struct MgContext{uvs:array<vec2f,8>,world:vec3f,eye:vec3f,origin:vec3f,vertexNormal:vec3f,pixelNormal:vec3f,vertexColor:vec4f,viewForward:vec3f,time:f32,realTime:f32,}',
)

/**
 * The direction an orthographic view looks along, from the view-projection matrix `viewProj`, for the
 * context's `viewForward` (`CameraVector`): zero for a perspective view, whose last row holds the
 * depth (the clip w), and for an orthographic one — a last row of (0, 0, 0, 1) — the axis its x and
 * y rows leave still, turned to the side of `world`, a point it draws, as seen from `eye`.
 */
export const VIEW_FORWARD_WGSL = wgslFn(
  'mgViewForward',
  [],
  `fn mgViewForward(viewProj:mat4x4f,eye:vec3f,world:vec3f)->vec3f{
 let depth=vec3f(viewProj[0][3],viewProj[1][3],viewProj[2][3]);
 if(dot(depth,depth)>1.0e-12){return vec3f(0.0);}
 let axis=cross(vec3f(viewProj[0][0],viewProj[1][0],viewProj[2][0]),vec3f(viewProj[0][1],viewProj[1][1],viewProj[2][1]));
 let length2=dot(axis,axis);
 if(length2<=0.0){return vec3f(0.0);}
 return axis*(select(-1.0,1.0,dot(axis,world-eye)>=0.0)*inverseSqrt(length2));
}`,
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

/** What one compilation is given: the graph, its domain, the slots of its values and how a texture
 *  read finds its footprint. The names of the declarations come after (`outputText`). */
export interface Compilation {
  readonly graph: MaterialGraph
  readonly domain: MaterialDomain
  readonly slots: Slots
  readonly derivatives: Derivatives
  /** Whether the pass fills the context's `vertexColor`; a graph that reads it is refused otherwise. */
  readonly vertexColor?: boolean
}

/** One output compiled: the lines of its function and what it reads. */
export interface CompiledOutput {
  readonly name: GraphOutput
  readonly body: string
  readonly uses: Uses
  readonly samples: readonly SampleRead[]
}

/** The lines of the function of one output: what the graph needs, then the value cast to the output's type. */
export function compileOutput(c: Compilation, name: GraphOutput): CompiledOutput {
  const pin = c.graph.outputs[name]
  if (!pin) throw graphError(`the ${name} output is not wired`)
  const state = new State({ ...c, output: name, translate: translateNode })
  const spec = GRAPH_OUTPUTS[name]
  const value = forceCast(state.value(pin), spec.type)
  if (value.type === 'texture') throw graphError(`a texture cannot be wired to ${name}`)
  const body = [...state.e.lines, `return ${value.code};`].join('\n ')
  return { name, body, uses: state.uses, samples: state.samples }
}

/** The function of the output `o`, its declaration named with `suffix`. */
export const outputText = (o: CompiledOutput, suffix: string) =>
  `fn ${outputFunction(o.name, suffix)}(ctx:MgContext,g:${valuesStruct(suffix)})->${wgslType(GRAPH_OUTPUTS[o.name].type)}{\n ${o.body}\n}`

/**
 * The lines of the function that asks the tile each texture read of the graph takes (`mgAsk`): for
 * the read `p.sel` names, the very texel it reads — its coordinate and footprint evaluated again from
 * the graph —, as the request of a map is made (`colorRequestIndex`), or zero past the last read.
 */
export function compileAsk(c: Compilation, reads: readonly SampleRead[]) {
  const branches = reads.map((read, at) => {
    const state = new State({ ...c, output: read.output, translate: translateNode })
    const request = sampleRequest(state, read.node)
    return `if(p.sel==${at}u){\n  ${[...state.e.lines, `return ${request};`].join('\n  ')}\n }`
  })
  return `${branches.join('\n ')}\n return 0u;`
}

/** The function that asks the tiles, from the lines of `compileAsk`, its declaration named with `suffix`. */
export const askText = (body: string, suffix: string) =>
  `fn ${askFunction(suffix)}(ctx:MgContext,g:${valuesStruct(suffix)},p:RequestPick,missing:bool)->u32{\n ${body}\n}`

/** The constant an inactive or unwired output takes. */
export const fallbackOf = (name: GraphOutput) => {
  const spec = GRAPH_OUTPUTS[name]
  return constantOf(spec.type, spec.fallback)
}

/** Whether `name` is compiled for `domain` under `reading`: wired and read. The `shadingModel` output is read only where the material
 *  says its model comes from the graph (`modelFromGraph`, "From Material Expression"). */
export const isCompiled = (
  graph: MaterialGraph,
  domain: MaterialDomain,
  name: GraphOutput,
  reading: GraphReading,
  modelFromGraph = true,
) =>
  !!graph.outputs[name] &&
  (modelFromGraph || name !== 'shadingModel') &&
  outputActive(domain, name, {
    ...reading,
    models: modelFromGraph && !!graph.outputs.shadingModel,
    water: isWaterGraph(graph.outputs),
    thin: isThinTranslucentGraph(graph.outputs),
  })

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
  readonly ask?: { body: string; request: WgslDecl }
  readonly sample?: WgslDecl
  /** Whether a node of the graph calls the noise functions. */
  readonly noise?: boolean
}

/** The block that declares the values a graph reads, the functions of its outputs and, when it reads
 *  a texture, the helper that reads a level of the atlas, on the atlas read `sample`
 *  (`colorSample`); in a program that finds footprints by neighbours, their contexts. */
export function programBlock(parts: BlockParts): WgslDecl {
  const { hash, suffix, slots, functions, ask } = parts
  const text = `struct ${valuesStruct(suffix)}{v:array<vec4f,${Math.max(slots.vectors.length, 1)}>,t:array<vec4u,${slots.textureRows}>,}
${functions.map((f) => outputText(f, suffix)).join('\n')}${ask ? `\n${askText(ask.body, suffix)}` : ''}`
  return wgslBlock(`materialGraph(${hash}${suffix})`, dependencies(parts), text)
}

/** The structure of the values a graph reads, alone: what a pass that evaluates some outputs of the
 *  graph apart (`outputProgram.ts`) declares once, whichever outputs it holds. */
export const valuesBlock = (hash: string, suffix: string, slots: Slots) =>
  wgslBlock(
    `materialGraphValues(${hash}${suffix})`,
    [],
    `struct ${valuesStruct(suffix)}{v:array<vec4f,${Math.max(slots.vectors.length, 1)}>,t:array<vec4u,${slots.textureRows}>,}`,
  )

/** The function of one output of a graph, over the values `values` (`valuesBlock`), on the colour
 *  read `sample`, which an output that reads a texture needs; footprints found by the neighbours'
 *  contexts. */
export const outputBlock = (
  hash: string,
  suffix: string,
  output: CompiledOutput,
  values: WgslDecl,
  sample?: WgslDecl,
) =>
  wgslBlock(
    `materialGraphOutput(${hash}.${output.name}${suffix})`,
    [
      values,
      ...dependencies({
        derivatives: 'neighbours',
        sample: output.uses.textures ? sample : undefined,
        noise: output.uses.noise,
      }),
    ],
    outputText(output, suffix),
  )

/** The declarations the block of a graph lists. */
function dependencies({
  derivatives,
  ask,
  sample,
  noise,
}: Pick<BlockParts, 'derivatives' | 'ask' | 'sample' | 'noise'>) {
  return [
    GRAPH_CONTEXT,
    ...(derivatives === 'neighbours' ? [NEIGHBOURS_WGSL] : []),
    ...(sample ? [sample, sampleLevelWgsl(sample)] : []),
    ...(ask ? [ask.request] : []),
    ...(noise ? [NOISE_WGSL] : []),
  ]
}
