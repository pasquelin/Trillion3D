import type { MaterialDomain } from '../../../../sdk-core/src/contracts/volumeMaterial.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import type { GraphNode, Pin } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import type { GraphOutput } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { outputMasks } from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { Emitter } from './emitter.ts'
import type { Slots } from './layout.ts'
import { mask } from './vector.ts'
import { constantOf, type Value } from './value.ts'

/** How a texture read finds the size of its footprint: from the screen, by the derivatives of the
 *  coordinate (`dpdx`, for a program whose pixels are neighbours), or from the footprint the host
 *  gives in the context (`ddx`, `ddy`). */
export type Derivatives = 'screen' | 'context'

/** What the nodes reached read from the world: set while a graph is compiled. */
export interface Uses {
  time: boolean
  position: boolean
  normal: boolean
  textures: boolean
  coordinates: boolean
}

/** What a compilation of one output is given. */
export interface StateInit {
  readonly graph: MaterialGraph
  readonly domain: MaterialDomain
  readonly output: GraphOutput
  readonly slots: Slots
  readonly derivatives: Derivatives
  readonly translate: (state: State, node: GraphNode) => Value
}

/** The compilation of one output: the graph, the lines being written, the slots, what is used. */
export class State {
  readonly e = new Emitter()
  readonly uses: Uses = {
    time: false,
    position: false,
    normal: false,
    textures: false,
    coordinates: false,
  }
  readonly graph: MaterialGraph
  readonly domain: MaterialDomain
  readonly output: GraphOutput
  readonly slots: Slots
  readonly derivatives: Derivatives
  private readonly memo = new Map<number, Value>()
  private readonly translate: StateInit['translate']

  constructor(init: StateInit) {
    this.graph = init.graph
    this.domain = init.domain
    this.output = init.output
    this.slots = init.slots
    this.derivatives = init.derivatives
    this.translate = init.translate
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
