import { lowestBit } from '../../../../math/src/scalar/bits.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'
import type { MaterialDomain } from '../../../../sdk-core/src/contracts/volumeMaterial.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import type { GraphNode, Pin } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import type { GraphOutput } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { outputMasks } from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { Emitter } from './emitter.ts'
import type { Slots } from './layout.ts'
import { mask } from './vector.ts'
import { constantOf, type Value } from './value.ts'

/** How a texture read finds the size of its footprint: from the screen's derivatives of the
 *  coordinate (`dpdx`, for a fragment program, whose pixels are neighbours), or by evaluating the
 *  coordinate again at the point a pixel to the right and a pixel below (`NEIGHBOURS`), for a
 *  program that has no derivative: their difference is what the hardware's derivative is. */
export type Derivatives = 'screen' | 'neighbours'

/** The contexts a footprint's two neighbours are read in, which the host fills before it calls an
 *  output: the point a pixel to the right, then a pixel below. */
export const NEIGHBOURS = ['mgNeighbour[0]', 'mgNeighbour[1]'] as const

/** What the nodes reached read from the world: set while a graph is compiled. `sets` is the mask of
 *  the texture coordinate sets read, bit `i` the set `i`. */
export interface Uses {
  time: boolean
  position: boolean
  normal: boolean
  colour: boolean
  noise: boolean
  textures: boolean
  /** Whether a sparse volume texture is read, which the host binds the volumes of. */
  sparseVolumes: boolean
  sets: number
}

/** The lowest texture set past the first that `sets` (`Uses.sets`) names, none (0) where it names none:
 *  the one a pass that carries a single set past the first reads for all of them. */
export const altSetOf = (sets: number) => {
  const past = (sets >> 1) & ((1 << (MAX_UV_SETS - 1)) - 1)
  return past ? lowestBit(past) + 1 : 0
}

/** The lowest texture set `sets` (`Uses.sets`) names, the first (0) where it names none. */
const lowestSetOf = (sets: number) => (sets ? lowestBit(sets) : 0)

/** The one texture set a raster carries for `what` (`lowestSetOf`): refused, naming `what`, where
 *  `sets` names more than one. */
export function singleSetOf(sets: number, what: string) {
  if (sets & (sets - 1))
    throw graphError(`the ${what} names more than one texture set: a raster carries one`)
  return lowestSetOf(sets)
}

/** A `Uses` with nothing read. */
export const noUses = (): Uses => ({
  time: false,
  position: false,
  normal: false,
  colour: false,
  noise: false,
  textures: false,
  sparseVolumes: false,
  sets: 0,
})

/** `from`'s reads united into `into`: the booleans or-ed, the sets of coordinates united. */
export function mergeUses(into: Uses, from: Uses) {
  into.time ||= from.time
  into.position ||= from.position
  into.normal ||= from.normal
  into.colour ||= from.colour
  into.noise ||= from.noise
  into.textures ||= from.textures
  into.sparseVolumes ||= from.sparseVolumes
  into.sets |= from.sets
}

/** A texture read of the graph: its sample node and the output it was reached from, which a request
 *  for the tile it takes is made from. */
export interface SampleRead {
  readonly node: GraphNode
  readonly output: GraphOutput
}

/** What a compilation of one output is given. */
export interface StateInit {
  readonly graph: MaterialGraph
  readonly domain: MaterialDomain
  readonly output: GraphOutput
  readonly slots: Slots
  readonly derivatives: Derivatives
  readonly translate: (state: State, node: GraphNode) => Value
  /** Whether the pass fills the context's `vertexColor`: a graph that reads it is refused where the
   *  pass does not. */
  readonly vertexColor?: boolean
  /** The WGSL name of the context read (`ctx`); another is the point a footprint is taken at. */
  readonly context?: string
  /** What a state of the same compile at another context shares with it (`State.at`). */
  readonly shared?: Pick<State, 'e' | 'uses' | 'samples' | 'footprints'>
  /** The state this one reads another point for: set on the states `State.at` makes. */
  readonly centre?: State
}

/** The compilation of one output: the graph, the lines being written, the slots, what is used. */
export class State {
  readonly e: Emitter
  readonly uses: Uses
  /** The texture reads met, each once, in the order the nodes were reached. */
  readonly samples: SampleRead[]
  /** The footprint (its two vectors' code) each texture read took at the centre, by node: a read of
   *  a coordinate at a point beside the centre takes the centre's, as the quad's derivative is
   *  every pixel's of it. */
  readonly footprints: Map<number, readonly [string, string]>
  /** The state this one is the point beside of: none for the centre. */
  readonly centre: State | undefined
  /** The WGSL name of the context the nodes read the point from. */
  readonly context: string
  readonly graph: MaterialGraph
  readonly domain: MaterialDomain
  readonly output: GraphOutput
  readonly slots: Slots
  readonly derivatives: Derivatives
  readonly vertexColor: boolean
  private readonly memo = new Map<number, Value>()
  private readonly beside = new Map<string, State>()

  private readonly init: StateInit

  constructor(init: StateInit) {
    this.init = init
    this.e = init.shared?.e ?? new Emitter()
    this.uses = init.shared?.uses ?? noUses()
    this.samples = init.shared?.samples ?? []
    this.footprints = init.shared?.footprints ?? new Map()
    this.centre = init.centre
    this.context = init.context ?? 'ctx'
    this.graph = init.graph
    this.domain = init.domain
    this.output = init.output
    this.slots = init.slots
    this.derivatives = init.derivatives
    this.vertexColor = init.vertexColor === true
  }

  /** The state of the same compile reading the point from `context`, made once: its lines, what it
   *  uses and its samples are this one's; its values are its own, kept, so that a node is read once
   *  at each point however many footprints ask it. */
  at(context: string) {
    let made = this.beside.get(context)
    if (!made)
      this.beside.set(
        context,
        (made = new State({ ...this.init, context, shared: this, centre: this })),
      )
    return made
  }

  /** The value of the output of the node `pin` names, its component mask applied. */
  value(pin: Pin): Value {
    const node = this.graph.nodes[pin.node]
    let whole = this.memo.get(node.id)
    if (!whole) this.memo.set(node.id, (whole = this.init.translate(this, node)))
    const letters = outputMasks(node.kind, node.props)[pin.output]
    return letters ? mask(this.e, whole, letters) : whole
  }

  /** The value wired to the input `name` of `node`, if any. */
  input(node: GraphNode, name: string): Value | undefined {
    const pin = node.inputs[name]
    return pin ? this.value(pin) : undefined
  }

  /** The value wired to `name`, or the node's own constant `fallback` where nothing is. */
  inputOr(node: GraphNode, name: string, fallback: string): Value {
    return this.input(node, name) ?? constantOf('flex', [node.props[fallback] as number])
  }
}
