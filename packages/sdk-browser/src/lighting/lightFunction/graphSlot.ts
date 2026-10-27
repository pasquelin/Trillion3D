import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import { compileGraph, type CompiledGraph } from '../../materials/graph/compile.ts'
import type { GraphClocks } from '../../materials/graph/clocks.ts'
import { fallbackOf } from '../../materials/graph/program.ts'
import { compileKept, isRefusal, type GraphRefusal } from '../../materials/graph/kept.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { tileDeclarations } from '../../materials/virtual/wgsl.ts'
import { MAP_BINDINGS, MAP_SAMPLER_BINDING } from './mapBindings.ts'
import { COLOR_SAMPLE, packSlotColour, type AtlasFormat } from './renderWgsl.ts'
import type { Derivatives } from '../../materials/graph/state.ts'

/** The bytes before a graph's values in a slot's parameters: the world's time in seconds and the
 *  wall clock's (`GraphClocks`), and padding. */
const HEAD_BYTES = 16

/** A material's graph compiled for the atlas: what its program is made of and how its parameters
 *  are written. */
export interface GraphSlot {
  readonly compiled: CompiledGraph
  /** The bytes of a slot's parameters. */
  readonly bytes: number
  /** Whether the graph reads the time: its slot is drawn again at each image. */
  readonly animated: boolean
  /** Whether the graph reads a texture: its program binds the colour atlas. */
  readonly textured: boolean
}

/** The graph of `material` compiled under the name `key` with the footprints `derivatives` give, once for each shape of the
 *  graph (a light function has no world position, so the compile refuses a node that reads one); none for a material with no
 *  graph; a refusal, naming the node, for a graph that does not compile — named by the frame that asks it (`nameRefusal`,
 *  `frame.ts`), not with the surfaces'. */
function compiledSlotOf(
  material: Material,
  key: string,
  derivatives: Derivatives,
): GraphSlot | GraphRefusal | undefined {
  const graph = material.graph as MaterialGraph | undefined
  if (!graph) return undefined
  return compileKept(
    graph,
    key,
    () => {
      const compiled = compileGraph(graph, { sample: COLOR_SAMPLE, derivatives })
      return {
        compiled,
        bytes: HEAD_BYTES + compiled.slots.bytes,
        animated: compiled.uses.time,
        textured: compiled.uses.textures,
      }
    },
    false,
  )
}

/** The graph of `material`, compiled for the atlas: a fragment program, whose texture reads take the screen's derivatives. */
export const graphSlotOf = (material: Material) => compiledSlotOf(material, 'atlas', 'screen')

/** The graph of `material`, compiled for the pass that evaluates it at a point apart from the atlas (`lightFunctionPassWgsl.ts`):
 *  a compute program, whose texture reads find their footprint at the points beside (`mgNeighbour`). */
const graphStandaloneOf = (material: Material) =>
  compiledSlotOf(material, 'standalone', 'neighbours')

/** A compiled slot, none where there is no graph or it is refused. */
const usable = (slot: GraphSlot | GraphRefusal | undefined) =>
  slot && !isRefusal(slot) ? slot : undefined

/** The compiled slot of `material`, none where it has no graph or its graph is refused. */
export const usableGraphSlot = (material: Material) => usable(graphSlotOf(material))

/** The compiled slot of `material` for the pass apart from the atlas, none where it has no graph or its graph is refused. */
export const usableGraphStandalone = (material: Material) => usable(graphStandaloneOf(material))

/** The textures a material's slot reads: those of its graph, else its emissive map. */
export function lightFunctionTextures(material: Material): Texture[] {
  const slot = usableGraphSlot(material)
  if (slot) return slot.compiled.slots.current(material.graph as MaterialGraph)
  const map = material.emissiveMap as Texture | null | undefined
  return map ? [map] : []
}

/**
 * The program that draws one slot of the atlas from a graph: the graph's emission (`mgEmissive`,
 * black where the graph wires none) at each texel of the slot of `slot` texels a side, its
 * coordinate from 0 at the slot's first to 1 at its last in every texture coordinate set. The
 * result is kept as `lightFunctionRenderWgsl` keeps it.
 */
export function graphSlotWgsl(slot: number, format: AtlasFormat, g: GraphSlot) {
  const emission = g.compiled.functions.emissive
  const colour = emission ? `${emission}(ctx,given.values)` : fallbackOf('emissive').code
  const text = `struct Given{head:vec4f,values:MgValues,}
@group(0) @binding(0) var<uniform> given:Given;
${g.textured ? `${tileDeclarations(MAP_BINDINGS, 'color')}\n@group(0) @binding(${MAP_SAMPLER_BINDING}) var mapsSampler:sampler;` : ''}
@fragment fn slotTexel(@builtin(position) at:vec4f)->@location(0) vec4u{
 let size=${wgslF32(slot)};
 let corner=floor(at.xy/size)*size;
 let uv=(at.xy-corner-vec2f(0.5))/(size-1.0);
 var ctx:MgContext;
 ctx.uvs=array<vec2f,8>(uv,uv,uv,uv,uv,uv,uv,uv);
 ctx.time=given.head.x;
 ctx.realTime=given.head.y;
 let graph_colour=${colour};
 ${packSlotColour(format, 'graph_colour')}
}`
  return wgslProgram(text, [g.compiled.wgsl, FULLSCREEN_VERTEX])
}

/** Writes a slot's parameters into `out` at `offset`: the world's time and the wall clock's, then
 *  the graph's values, each texture at the slot `slotOf` gives it. False while a texture has none. */
export function writeGraphSlot(
  g: GraphSlot,
  material: Material,
  out: ArrayBuffer,
  clocks: GraphClocks,
  slotOf: (texture: Texture) => number | undefined,
) {
  const head = new Float32Array(out, 0, 2)
  head[0] = clocks.time
  head[1] = clocks.realTime
  return g.compiled.slots.fill(material.graph as MaterialGraph, out, HEAD_BYTES, slotOf)
}
