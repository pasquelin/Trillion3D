import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import {
  DOMAIN_OUTPUTS,
  type GraphBlend,
  type GraphOutput,
} from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { validateGraph } from '../../../../sdk-core/src/world/material/graph/validate.ts'
import { Slots } from './layout.ts'
import {
  askFunction,
  compileAsk,
  compileOutput,
  isCompiled,
  outputFunction,
  programBlock,
  valuesStruct,
  type CompiledOutput,
  type Compilation,
} from './program.ts'
import { noUses, type Derivatives, type SampleRead, type Uses } from './state.ts'

/** What the host gives to compile a graph. */
export interface CompileOptions {
  /** The declaration of the colour atlas read (`colorSample`): the pool of the reading pass. */
  readonly sample: WgslDecl
  /** How a texture read sizes its footprint. */
  readonly derivatives: Derivatives
  /** How a surface blends, which says whether its opacity or its mask is read; opaque by default. */
  readonly blend?: GraphBlend
  /** The declarations of the tile requests (`RequestPick`, `colorRequestIndex`) of a pass that
   *  streams the textures it reads: the graph then holds `ask`, the function that asks the tile of
   *  each of its texture reads. */
  readonly request?: WgslDecl
  /** Names the graph's declarations apart where one program holds several graphs: written after
   *  the name of each function and of the structure of the values. Empty by default. */
  readonly suffix?: string
}

/** A graph compiled: the block to put in a program, the function of each wired output, the layout
 *  of the values it reads, and what it uses. */
export interface CompiledGraph {
  /** The declarations: `MgContext`, the structure of the values and one function a wired output. */
  readonly wgsl: WgslDecl
  /** Tells this program from another: its text's hash, the one name a program is kept by. */
  readonly hash: string
  /** The name of the function of each output compiled, `(ctx: MgContext, g)`. */
  readonly functions: Partial<Record<GraphOutput, string>>
  /** The values it reads, as the bytes of the structure and the parameters and textures that fill it. */
  readonly slots: Slots
  readonly uses: Uses
  /** The suffix that names its declarations (`CompileOptions.suffix`), and the name of the
   *  structure of the values (`MgValues` and the suffix). */
  readonly suffix: string
  readonly values: string
  /** The texture reads of the graph, each one a pick of the tile request, and the name of the
   *  function that asks the tile of a pick (`(ctx, g, p: RequestPick, missing)`), where the graph
   *  was compiled with `request`. */
  readonly reads: number
  readonly ask?: string
}

/** A short word naming `text`, to tell two graphs' blocks apart in one program. */
function hashOf(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** The sum of what `outputs` use: the booleans or-ed, the sets of coordinates united. */
function usedBy(outputs: readonly CompiledOutput[]) {
  const uses = noUses()
  for (const { uses: of } of outputs) {
    uses.time ||= of.time
    uses.position ||= of.position
    uses.normal ||= of.normal
    uses.textures ||= of.textures
    uses.sets |= of.sets
  }
  return uses
}

/** The texture reads of `outputs`, each once, in the order they were met. */
function readsOf(outputs: readonly CompiledOutput[]) {
  const reads: SampleRead[] = []
  for (const { samples } of outputs)
    for (const read of samples) if (!reads.some((r) => r.node.id === read.node.id)) reads.push(read)
  return reads
}

/**
 * Compiles the wired outputs of `graph` that its domain reads (an output the surface does not read
 * under its blend — opacity opaque, the mask unmasked — takes its fallback and is not compiled)
 * into one function each. The graph is checked first (`validateGraph`); a type error, a node that
 * has no value in the domain or an output the domain does not read is an `INVALID_MATERIAL` error
 * naming the node.
 */
export function compileGraph(graph: MaterialGraph, options: CompileOptions): CompiledGraph {
  validateGraph(graph)
  const { domain } = graph
  const blend = options.blend ?? 'opaque'
  const suffix = options.suffix ?? ''
  const slots = new Slots()
  const c: Compilation = { graph, domain, slots, derivatives: options.derivatives, suffix }
  const compiled = DOMAIN_OUTPUTS[domain]
    .filter((name) => isCompiled(graph, domain, name, blend))
    .map((name) => compileOutput(c, name))
  const uses = usedBy(compiled)
  const reads = readsOf(compiled)
  const request = options.request && reads.length ? options.request : undefined
  const ask = request ? compileAsk(c, reads) : undefined
  const text = `${compiled.map((o) => o.text).join('\n')}${ask ?? ''}`
  const hash = hashOf(`${text}|${slots.vectors.length}|${slots.textures.length}`)
  const block = programBlock({
    hash,
    suffix,
    slots,
    derivatives: options.derivatives,
    functions: compiled,
    ask: request && ask ? { text: ask, request } : undefined,
    sample: uses.textures ? options.sample : undefined,
  })
  return {
    wgsl: block,
    hash,
    functions: Object.fromEntries(compiled.map((o) => [o.name, outputFunction(o.name, suffix)])),
    slots,
    uses,
    suffix,
    values: valuesStruct(suffix),
    reads: reads.length,
    ask: ask ? askFunction(suffix) : undefined,
  }
}
