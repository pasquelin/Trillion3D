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
  askText,
  compileAsk,
  compileOutput,
  isCompiled,
  outputFunction,
  outputText,
  programBlock,
  valuesStruct,
  type CompiledOutput,
  type Compilation,
} from './program.ts'
import { mergeUses, noUses, type Derivatives, type SampleRead, type Uses } from './state.ts'

/** What the host gives to compile a graph. */
export interface CompileOptions {
  /** The declaration of the colour atlas read (`colorSample`): the pool of the reading pass. */
  readonly sample: WgslDecl
  /** How a texture read sizes its footprint. */
  readonly derivatives: Derivatives
  /** How a surface blends, which says whether its opacity or its mask is read; opaque by default. */
  readonly blend?: GraphBlend
  /** Whether the surface is lit: an unlit one reads its emission, opacity and mask alone
   *  (`outputActive`). Lit by default. */
  readonly lit?: boolean
  /** Whether the transparent pass draws the surface: only there is its refraction read. True by default. */
  readonly translucent?: boolean
  /** Whether the emission may be negative (a material's `allowNegativeEmissive`): the passes that hold
   *  it at zero (`emissiveOf`) do not. A graph that differs in it is another program. */
  readonly negativeEmissive?: boolean
  /** Whether the pass fills the context's `vertexColor`, which a graph that reads the vertex colour
   *  needs: it is refused where the pass does not. False by default. */
  readonly vertexColor?: boolean
  /** The declarations of the tile requests (`RequestPick`, `colorRequestIndex`) of a pass that
   *  streams the textures it reads: the graph then holds `ask`, the function that asks the tile of
   *  each of its texture reads. */
  readonly request?: WgslDecl
  /** Names the graph's declarations apart where one program holds several graphs: written after
   *  the name of each function and of the structure of the values. Empty by default. */
  readonly suffix?: string
  /** Names them by the graph's own hash (`CompiledGraph.hash`), the suffix a program that holds
   *  several graphs gives each: found from the one compile. */
  readonly named?: boolean
  /** Whether the `shadingModel` output decides the pixels' model: only where the material says `fromMaterialExpression`. True by default. */
  readonly modelFromGraph?: boolean
}

/** A graph compiled: the block to put in a program, the function of each wired output, the layout
 *  of the values it reads, and what it uses. */
export interface CompiledGraph {
  /** The declarations: `MgContext`, the structure of the values and one function a wired output. */
  readonly wgsl: WgslDecl
  /** Tells this program from another: its text's hash (sixty-four bits), the name it is declared and
   *  cached by. */
  readonly hash: string
  /** Whether the emission is left as it is computed (`CompileOptions.negativeEmissive`). */
  readonly negativeEmissive: boolean
  /** Whether it was compiled for a lit surface (`CompileOptions.lit`). */
  readonly lit: boolean
  /** The text a program is known by, whole: two graphs of the same `key` are one program, which no
   *  collision of `hash` can make of two other graphs. The text with no suffix, and what the
   *  values' layout adds to it. */
  readonly key: string
  /** The name of the function of each output compiled, `(ctx: MgContext, g)`. */
  readonly functions: Partial<Record<GraphOutput, string>>
  /** The outputs compiled, each with the lines of its function and what it alone uses: what a pass
   *  that evaluates one output apart (`maskProgram.ts`) declares again under its own names. */
  readonly outputs: readonly CompiledOutput[]
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

/** A word naming `text`, sixty-four bits: two sums of its characters that mix them differently, in
 *  base 36, seven digits each. */
function hashOf(text: string) {
  let a = 2166136261,
    b = 0x9747b28c
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 16777619)
    b = Math.imul(b ^ c, 0x5bd1e995)
    b ^= b >>> 13
  }
  const word = (h: number) => (h >>> 0).toString(36).padStart(7, '0')
  return `${word(a)}${word(b)}`
}

/** What a reading of a surface adds to the key of its program, each flag as the compile resolves it. */
export const readingKey = (
  reading: Required<
    Pick<CompileOptions, 'negativeEmissive' | 'lit' | 'translucent' | 'modelFromGraph'>
  >,
) => `${reading.negativeEmissive}|${reading.lit}|${reading.translucent}|${reading.modelFromGraph}`

/** The sum of what `outputs` use: the booleans or-ed, the sets of coordinates united. */
function usedBy(outputs: readonly CompiledOutput[]) {
  const uses = noUses()
  for (const { uses: of } of outputs) mergeUses(uses, of)
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
  const lit = options.lit !== false
  const translucent = options.translucent !== false
  const slots = new Slots()
  const c: Compilation = {
    graph,
    domain,
    slots,
    derivatives: options.derivatives,
    vertexColor: options.vertexColor,
  }
  const compiled = DOMAIN_OUTPUTS[domain]
    .filter((name) =>
      isCompiled(
        graph,
        domain,
        name,
        { blend, lit, translucent },
        options.modelFromGraph !== false,
      ),
    )
    .map((name) => compileOutput(c, name))
  const uses = usedBy(compiled)
  const reads = readsOf(compiled)
  const request = options.request && reads.length ? options.request : undefined
  const ask = request ? compileAsk(c, reads) : undefined
  const text = `${compiled.map((o) => outputText(o, '')).join('\n')}${ask ? askText(ask, '') : ''}`
  const negativeEmissive = options.negativeEmissive === true
  const key = `${text}|${slots.vectors.length}|${slots.textures.length}|${readingKey({ negativeEmissive, lit, translucent, modelFromGraph: options.modelFromGraph !== false })}`
  const hash = hashOf(key)
  const suffix = options.suffix ?? (options.named ? `_${hash}` : '')
  const block = programBlock({
    hash,
    suffix,
    slots,
    derivatives: options.derivatives,
    functions: compiled,
    ask: request && ask ? { body: ask, request } : undefined,
    sample: uses.textures ? options.sample : undefined,
    noise: uses.noise,
  })
  return {
    wgsl: block,
    hash,
    key,
    negativeEmissive,
    lit,
    functions: Object.fromEntries(compiled.map((o) => [o.name, outputFunction(o.name, suffix)])),
    outputs: compiled,
    slots,
    uses,
    suffix,
    values: valuesStruct(suffix),
    reads: reads.length,
    ask: ask ? askFunction(suffix) : undefined,
  }
}
