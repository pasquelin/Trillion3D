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
import type { Pin } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { Slots } from './layout.ts'
import { blendStruct } from './closureBlend.ts'
import { NOISE_WGSL } from './noiseWgsl.ts'
import { sampleRequest } from './nodesTexture.ts'
import {
  State,
  type InternalOutput,
  type Derivatives,
  type SampleRead,
  type Uses,
} from './state.ts'
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
  /** The wires the graph reads its outputs from (`closureOutputs`), merged once for the compile. */
  readonly outputs: Partial<Record<GraphOutput, Pin>>
  readonly domain: MaterialDomain
  readonly slots: Slots
  readonly derivatives: Derivatives
  /** Whether the pass fills the context's `vertexColor`; a graph that reads it is refused otherwise. */
  readonly vertexColor?: boolean
}

/** One output compiled: the lines of its function and what it reads. */
export interface CompiledOutput {
  /** The output, or the function a closure tree adds (`INTERNAL_OUTPUTS`). */
  readonly name: GraphOutput | InternalOutput
  /** The slab of the closure tree it is an attribute of, none for the primary slab and the graph's own outputs. */
  readonly slab?: number
  /** The wire of the scalar a closure operator reads (`operandKey`). */
  readonly operand?: string
  /** The root of the subtree a `closureBlend` mixes into one closure (`closureBlend.ts`). */
  readonly root?: number
  /** The lines of the function, written for the suffix that names the declarations it calls where they depend on it (`closureBlend`). */
  readonly bodyOf?: (suffix: string) => string
  readonly body: string
  readonly uses: Uses
  readonly samples: readonly SampleRead[]
}

/** The lines of the function of one output: what the graph needs, then the value cast to the output's type. `pin` and `slab` name the
 *  wire of an attribute of a slab of the closure tree, the graph's own output `name` where not given. */
export function compileOutput(
  c: Compilation,
  name: GraphOutput,
  pin: Pin | undefined = c.outputs[name],
  slab?: number,
): CompiledOutput {
  if (!pin) throw graphError(`the ${name} output is not wired`)
  const state = new State({ ...c, output: name, translate: translateNode })
  const spec = GRAPH_OUTPUTS[name]
  const value = forceCast(state.value(pin), spec.type)
  if (value.type === 'texture' || value.type === 'sparseVolume')
    throw graphError(`a texture cannot be wired to ${name}`)
  const body = [...state.e.lines, `return ${value.code};`].join('\n ')
  return { name, slab, body, uses: state.uses, samples: state.samples }
}

/** What names the scalar a closure operator reads at `pin`: two operators reading one wire share a function. */
export const operandKey = (pin: Pin) => `${pin.node}_${pin.output}`

/** The function of the scalar `pin` a closure operator reads, cast to one component. */
export function compileOperand(c: Compilation, pin: Pin): CompiledOutput {
  const state = new State({ ...c, output: 'closureOperand', translate: translateNode })
  const value = forceCast(state.value(pin), 'f1')
  if (value.type === 'texture' || value.type === 'sparseVolume')
    throw graphError('a texture cannot be wired to a closure operator')
  const body = [...state.e.lines, `return ${value.code};`].join('\n ')
  return {
    name: 'closureOperand',
    operand: operandKey(pin),
    body,
    uses: state.uses,
    samples: state.samples,
  }
}

/** What names and types the functions a closure tree adds: an operand by its wire, a blend by the root of its subtree. */
const INTERNAL_OUTPUTS = {
  closureOperand: {
    name: (o, suffix) => `mgClosureOperand${o.operand}${suffix}`,
    type: () => 'f32',
  },
  closureBlend: {
    name: (o, suffix) => `mgClosureBlend${o.root}${suffix}`,
    type: (_, suffix) => `MgBlend${suffix}`,
  },
} as const satisfies Record<
  InternalOutput,
  {
    name: (o: CompiledOutput, suffix: string) => string
    type: (o: CompiledOutput, suffix: string) => string
  }
>

/** Whether `name` is a function a closure tree adds, not an output of the graph. */
export const isInternalOutput = (name: GraphOutput | InternalOutput): name is InternalOutput =>
  name in INTERNAL_OUTPUTS

/** The name of the function of `o`: its output's (`outputFunction`), the slab's rank after it for a slab's attribute, an internal one's own. */
export const compiledFunction = (o: CompiledOutput, suffix = '') =>
  isInternalOutput(o.name)
    ? INTERNAL_OUTPUTS[o.name].name(o, suffix)
    : o.slab === undefined
      ? outputFunction(o.name, suffix)
      : `${outputFunction(o.name)}S${o.slab}${suffix}`

/** The type a compiled function returns. */
const returnType = (o: CompiledOutput, suffix: string) =>
  isInternalOutput(o.name)
    ? INTERNAL_OUTPUTS[o.name].type(o, suffix)
    : wgslType(GRAPH_OUTPUTS[o.name].type)

/** The function of the output `o`, its declaration named with `suffix`. */
export const outputText = (o: CompiledOutput, suffix: string) =>
  `fn ${compiledFunction(o, suffix)}(ctx:MgContext,g:${valuesStruct(suffix)})->${returnType(o, suffix)}{\n ${o.bodyOf?.(suffix) ?? o.body}\n}`

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

/** The code that calls the output `name` of `compiled` at the context `ctx`, over the graph values `values`, or the output's constant
 *  where the graph wires none. */
export const outputCall = (
  compiled: { readonly functions: Partial<Record<GraphOutput, string>> },
  name: GraphOutput,
  values: string,
) => {
  const fn = compiled.functions[name]
  return fn ? `${fn}(ctx,${values})` : fallbackOf(name).code
}

/** Whether `name` is compiled for `domain` under `reading`: wired and read. The `shadingModel` output is read only where the material
 *  says its model comes from the graph (`modelFromGraph`, "From Material Expression"). */
export const isCompiled = (
  graph: MaterialGraph,
  domain: MaterialDomain,
  name: GraphOutput,
  reading: GraphReading,
  modelFromGraph = true,
  outputs: Partial<Record<GraphOutput, Pin>> = graph.outputs,
) =>
  !!outputs[name] &&
  (modelFromGraph || name !== 'shadingModel') &&
  outputActive(domain, name, {
    ...reading,
    models: modelFromGraph && !!outputs.shadingModel,
    water: isWaterGraph(outputs),
    thin: isThinTranslucentGraph(outputs),
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
  const blends = functions.some((f) => f.name === 'closureBlend')
  const text = `struct ${valuesStruct(suffix)}{v:array<vec4f,${Math.max(slots.vectors.length, 1)}>,t:array<vec4u,${slots.textureRows}>,}${blends ? `\n${blendStruct(suffix)}` : ''}
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
