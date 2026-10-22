import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import {
  DOMAIN_OUTPUTS,
  type GraphBlend,
  type GraphOutput,
} from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { validateGraph } from '../../../../sdk-core/src/world/material/graph/validate.ts'
import { Slots } from './layout.ts'
import { compileOutput, isCompiled, outputFunction, programBlock } from './program.ts'
import type { Derivatives, Uses } from './state.ts'

/** What the host gives to compile a graph. */
export interface CompileOptions {
  /** The declaration of the colour atlas read (`colorSample`): the pool of the reading pass. */
  readonly sample: WgslDecl
  /** How a texture read sizes its footprint. */
  readonly derivatives: Derivatives
  /** How a surface blends, which says whether its opacity or its mask is read; opaque by default. */
  readonly blend?: GraphBlend
}

/** A graph compiled: the block to put in a program, the function of each wired output, the layout
 *  of the values it reads, and what it uses. */
export interface CompiledGraph {
  /** The declarations: `MgContext`, `MgValues` and one function a wired output. */
  readonly wgsl: WgslDecl
  /** The name of the function of each output compiled, `(ctx: MgContext, g: MgValues)`. */
  readonly functions: Partial<Record<GraphOutput, string>>
  /** The values it reads, as the bytes of `MgValues` and the parameters and textures that fill them. */
  readonly slots: Slots
  readonly uses: Uses
}

/** A short word naming `text`, to tell two graphs' blocks apart in one program. */
function hashOf(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
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
  const slots = new Slots()
  const uses: Uses = {
    time: false,
    position: false,
    normal: false,
    textures: false,
    coordinates: false,
  }
  const compiled = DOMAIN_OUTPUTS[domain]
    .filter((name) => isCompiled(graph, domain, name, blend))
    .map((name) => compileOutput(graph, domain, name, slots, options.derivatives))
  for (const output of compiled)
    for (const key of Object.keys(uses) as (keyof Uses)[]) uses[key] ||= output.uses[key]
  const text = compiled.map((c) => c.text).join('\n')
  const hash = hashOf(`${text}|${slots.vectors.length}|${slots.textures.length}`)
  return {
    wgsl: programBlock(hash, slots, compiled, uses.textures ? options.sample : undefined),
    functions: Object.fromEntries(compiled.map((c) => [c.name, outputFunction(c.name)])),
    slots,
    uses,
  }
}
