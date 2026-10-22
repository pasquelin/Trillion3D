import { GraphStore, type Pin } from './graph.ts'
import { NODE_SPECS, outputMasks, type NodeKind, type NodeProp } from './nodeSpecs.ts'
import { graphError } from './valueType.ts'

/** What a node takes where a wire may go: a wire, or a number, which is the node's own constant
 *  where it has one (`constA`) and a constant node otherwise; nothing keeps the node's default. */
export type Wire = Pin | number | undefined

const upper = (word: string) => word[0].toUpperCase() + word.slice(1)

/** The entries of `values` that hold something. */
export const given = (values: Record<string, NodeProp | undefined>) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Record<
    string,
    NodeProp
  >

/** The store with the calls every node call is made of: constants, channels and the wiring of
 *  arguments. */
export class WiredGraph extends GraphStore {
  /** Adds `kind` with the arguments given as wires or numbers and the properties over its defaults. */
  protected wire(kind: NodeKind, args: Record<string, Wire>, props: Record<string, NodeProp> = {}) {
    const inputs: Record<string, Pin> = {}
    for (const [name, value] of Object.entries(args)) {
      if (value === undefined) continue
      const constant = `const${upper(name)}`
      if (typeof value !== 'number') inputs[name] = value
      else if (constant in NODE_SPECS[kind].props) props[constant] = value
      else inputs[name] = this.constant(value)
    }
    return this.addNode(kind, props, inputs)
  }

  /** A constant of one to four numbers. */
  constant(...value: number[]) {
    if (value.length < 1 || value.length > 4)
      throw graphError('a constant holds one to four numbers')
    return this.addNode('constant', { value })
  }

  /** The output of `pin`'s node that is the components `mask` ('rgb', 'r', 'a'…). */
  channel(pin: Pin, mask: string): Pin {
    const node = this.nodes[pin.node]
    const at = outputMasks(node.kind, node.props).indexOf(mask)
    if (at < 0) throw graphError(`${node.kind} has no '${mask}' output`, { node: pin.node })
    return { node: pin.node, output: at }
  }
}
