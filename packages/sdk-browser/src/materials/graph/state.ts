import type { MaterialDomain } from '../../../../sdk-core/src/contracts/volumeMaterial.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import type { GraphNode, Pin } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import type { GraphOutput } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { outputMasks } from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
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
  textures: boolean
  sets: number
}

/** A `Uses` with nothing read. */
export const noUses = (): Uses => ({
  time: false,
  position: false,
  normal: false,
  textures: false,
  sets: 0,
})

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
  /** The WGSL name of the context read (`ctx`); another is the point a footprint is taken at. */
  readonly context?: string
  /** What a state of the same compile at another context shares with it (`State.at`). */
  readonly shared?: Pick<State, 'e' | 'uses' | 'samples'>
}

/** The compilation of one output: the graph, the lines being written, the slots, what is used. */
export class State {
  readonly e: Emitter
  readonly uses: Uses
  /** The texture reads met, each once, in the order the nodes were reached. */
  readonly samples: SampleRead[]
  /** The WGSL name of the context the nodes read the point from. */
  readonly context: string
  readonly graph: MaterialGraph
  readonly domain: MaterialDomain
  readonly output: GraphOutput
  readonly slots: Slots
  readonly derivatives: Derivatives
  private readonly memo = new Map<number, Value>()
  private readonly translate: StateInit['translate']

  constructor(init: StateInit) {
    this.e = init.shared?.e ?? new Emitter()
    this.uses = init.shared?.uses ?? noUses()
    this.samples = init.shared?.samples ?? []
    this.context = init.context ?? 'ctx'
    this.graph = init.graph
    this.domain = init.domain
    this.output = init.output
    this.slots = init.slots
    this.derivatives = init.derivatives
    this.translate = init.translate
  }

  /** A state of the same compile reading the point from `context`: its lines, what it uses and
   *  its samples are this one's; its values are its own. */
  at(context: string) {
    return new State({
      graph: this.graph,
      domain: this.domain,
      output: this.output,
      slots: this.slots,
      derivatives: this.derivatives,
      translate: this.translate,
      context,
      shared: this,
    })
  }

  /** The value of the output of the node `pin` names, its component mask applied. */
  value(pin: Pin): Value {
    const node = this.graph.nodes[pin.node]
    let whole = this.memo.get(node.id)
    if (!whole) this.memo.set(node.id, (whole = this.translate(this, node)))
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
