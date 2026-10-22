import type { MaterialDomain } from '../../../contracts/volumeMaterial.ts'
import { createListeners } from '../../../runtime/listeners.ts'
import type { Texture } from '../../texture/texture.ts'
import {
  NODE_SPECS,
  outputMasks,
  type NodeKind,
  type NodeProp,
  type NodeSpec,
} from './nodeSpecs.ts'
import { assertDomainOutput, isGraphDomain, type GraphOutput } from './outputs.ts'
import { graphError } from './valueType.ts'

/** A wire's source: the output `output` of the node `node`. */
export interface Pin {
  readonly node: number
  readonly output: number
}

/** A node as a graph holds and saves it: its rank, its kind, its properties and its input wires. */
export interface GraphNode {
  readonly id: number
  readonly kind: NodeKind
  readonly props: Record<string, NodeProp>
  readonly inputs: Record<string, Pin>
}

/** A graph as a saved world holds it. A texture is not stored: a graph that holds one refuses to
 *  be saved, as a material that holds one does. */
export interface GraphData {
  readonly domain: MaterialDomain
  readonly nodes: readonly GraphNode[]
  readonly outputs: Partial<Record<GraphOutput, Pin>>
  /** The numbers written to parameters by name (`set`). */
  readonly values?: Record<string, number | readonly number[]>
}

/** A value a parameter takes: a scalar, a colour or vector, or a texture. */
export type ParameterValue = number | readonly number[] | Texture

const sameKind = (given: NodeProp, start: NodeProp) =>
  Array.isArray(start)
    ? Array.isArray(given) && given.every((n) => Number.isFinite(n))
    : typeof given === typeof start && (typeof given !== 'number' || Number.isFinite(given))

/**
 * THE STORE OF A MATERIAL GRAPH: nodes wired into the outputs of one domain. A wire may only name a
 * node already in the graph, so a graph has no cycle. Parameters are named; their values (`set`)
 * are kept beside the nodes and override the node's own. A write tells the material that holds it.
 */
export class GraphStore {
  readonly isMaterialGraph = true as const
  readonly domain: MaterialDomain
  readonly nodes: GraphNode[] = []
  readonly outputs: Partial<Record<GraphOutput, Pin>> = {}
  /** The texture of a texture node, by node rank. */
  readonly textures = new Map<number, Texture>()
  /** The values written by name to a parameter, over those of its nodes. */
  readonly values = new Map<string, ParameterValue>()
  /** Bumped by every write. */
  version = 0
  readonly _listeners = createListeners()

  constructor(domain: MaterialDomain) {
    if (!isGraphDomain(domain)) throw graphError(`unknown domain '${String(domain)}'`)
    this.domain = domain
  }

  /** Tells the material holding this graph that it changed. */
  protected changed() {
    this.version++
    this._listeners.emit()
  }

  /** Adds a node with the properties and wires given over its kind's defaults; returns its
   *  first output. A property or an input the kind does not have is refused. */
  addNode(
    kind: NodeKind,
    props: Record<string, NodeProp> = {},
    inputs: Record<string, Pin> = {},
    texture?: Texture,
  ): Pin {
    const spec: NodeSpec | undefined = NODE_SPECS[kind]
    if (!spec) throw graphError(`unknown node '${String(kind)}'`)
    for (const [name, value] of Object.entries(props))
      if (!(name in spec.props) || !sameKind(value, spec.props[name]))
        throw graphError(`${kind} has no property '${name}' of that kind`, { kind, name })
    for (const [name, pin] of Object.entries(inputs)) {
      if (!spec.inputs.includes(name))
        throw graphError(`${kind} has no input '${name}'`, { kind, name })
      this.assertPin(pin)
    }
    const id = this.nodes.length
    this.nodes.push({ id, kind, props: { ...spec.props, ...props }, inputs: { ...inputs } })
    if (texture) this.holdTexture(id, texture)
    this.changed()
    return { node: id, output: 0 }
  }

  private assertPin(pin: Pin) {
    const node = this.nodes[pin?.node]
    if (
      !node ||
      !Number.isInteger(pin.output) ||
      pin.output < 0 ||
      pin.output >= outputMasks(node.kind, node.props).length
    )
      throw graphError('a wire names a node or output that does not exist', { pin })
  }

  private holdTexture(id: number, texture: Texture) {
    if (!texture.isTexture) throw graphError('a texture node needs a texture')
    this.textures.set(id, texture)
    texture._listeners?.subscribe(() => this.changed())
  }

  /** Wires `pin` into the output `name` of the graph; the domain must read it. */
  output(name: string, pin: Pin) {
    assertDomainOutput(this.domain, name)
    this.assertPin(pin)
    this.outputs[name] = pin
    this.changed()
  }

  /** Gives the parameter `name` a value: a number for a scalar, up to four numbers for a vector or
   *  a colour, a texture for a texture parameter. */
  set(name: string, value: ParameterValue) {
    if ((value as Texture).isTexture) (value as Texture)._listeners?.subscribe(() => this.changed())
    this.values.set(name, value)
    this.changed()
  }
}
