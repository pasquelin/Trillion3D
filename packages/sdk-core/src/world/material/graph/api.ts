import { EngineError } from '../../../contracts/cache.ts'
import type { Texture } from '../../texture/texture.ts'
import { InputGraph } from './inputs.ts'
import type { GraphData, Pin } from './graph.ts'
import { flattenClosures } from './closureFlatten.ts'
import { MAX_CLOSURES, assertClosureTree, type ClosureOutput, type Operand } from './closures.ts'
import { isGraphDomain } from './outputs.ts'
import { graphError } from './valueType.ts'

/**
 * THE MATERIAL GRAPH: the nodes of a material wired into its outputs (`output`), written as calls
 * that each give the wire of the node they add. A graph is made for one domain — `'surface'`,
 * `'lightFunction'` or `'volume'` — which says what its outputs may be, and is worn by a material
 * of that domain (`material.graph`).
 *
 * ```ts
 * const g = new MaterialGraph('lightFunction')
 * const spots = g.textureSample(texture, { uv: g.panner({ speed: [0.05, 0] }) })
 * g.output('emissive', g.multiply(g.channel(spots, 'rgb'), g.constant(1, 0.8, 0.5)))
 * ```
 */
export class MaterialGraph extends InputGraph {
  /** A slab of a closure tree: the closure whose attributes are the wires given (`CLOSURE_OUTPUTS`); returns its rank among the closure nodes. */
  slab(attributes: Partial<Record<ClosureOutput, Pin>>) {
    return this.addClosureNode({ kind: 'slab', attributes: { ...attributes } })
  }
  /** The horizontal mix of two closures side by side: `foreground` takes the share `mix` (0.5 where not given), `background` the rest.
   *  `blend` asks the mix to be one closure with the parameters mixed. */
  horizontalMix(background: number, foreground: number, mix: Operand = 0.5, blend = false) {
    return this.addClosureNode({ kind: 'horizontal', background, foreground, mix, blend })
  }
  /** The vertical layering of `top` over `base`: the base is seen through the top. */
  verticalLayer(top: number, base: number, blend = false) {
    return this.addClosureNode({ kind: 'vertical', top, base, blend })
  }
  /** The sum of two closures, each at its own coverage. */
  addClosures(a: number, b: number, blend = false) {
    return this.addClosureNode({ kind: 'add', a, b, blend })
  }
  /** A closure weighted by `weight` (0 to 1). */
  weightClosure(input: number, weight: Operand) {
    return this.addClosureNode({ kind: 'weight', input, weight })
  }
  /** Makes the closure node `root` the surface's tree: the surface has the closures it flattens to (at most `MAX_CLOSURES`, `flattenClosures`),
   *  a tree of more operators than the format holds being refused here. */
  closures(root: number) {
    assertClosureTree(this.closureNodes, root)
    flattenClosures(this.closureNodes, root, MAX_CLOSURES)
    this.setClosureRoot(root)
  }

  /** The graph as a saved world holds it; a graph holding a texture is refused. */
  toJSON(): GraphData {
    const written = [...this.values]
    if (this.textures.size || written.some(([, value]) => (value as Texture).isTexture))
      throw new EngineError('SCENE_NOT_SAVABLE', 'A saved scene cannot store a texture', {
        parameter: 'graph',
      })
    return {
      domain: this.domain,
      nodes: this.nodes.map((node) => structuredClone(node)),
      outputs: structuredClone(this.outputs),
      ...(this.closureRoot !== undefined && {
        closures: { nodes: structuredClone(this.closureNodes), root: this.closureRoot },
      }),
      ...(written.length && { values: Object.fromEntries(written) as GraphData['values'] }),
    }
  }

  /** A graph made again from `data`, every node and wire checked as when it was made. */
  static fromJSON(data: GraphData) {
    if (!data || !isGraphDomain(data.domain) || !Array.isArray(data.nodes))
      throw graphError('not a saved graph')
    const graph = new MaterialGraph(data.domain)
    for (const node of data.nodes) {
      if (node.id !== graph.nodes.length)
        throw graphError('a saved graph lists its nodes out of order')
      graph.addNode(node.kind, node.props, node.inputs)
    }
    for (const [name, pin] of Object.entries(data.outputs ?? {})) graph.output(name, pin)
    if (data.closures) graph.restoreClosures(data.closures)
    for (const [name, value] of Object.entries(data.values ?? {})) graph.set(name, value)
    return graph
  }

  /** A copy: the same nodes, wires, textures and parameter values. */
  clone() {
    const graph = new MaterialGraph(this.domain)
    for (const node of this.nodes)
      graph.addNode(node.kind, node.props, node.inputs, this.textures.get(node.id))
    for (const [name, pin] of Object.entries(this.outputs)) graph.output(name, pin)
    if (this.closureRoot !== undefined)
      graph.restoreClosures({ nodes: this.closureNodes, root: this.closureRoot })
    for (const [name, value] of this.values) graph.set(name, value)
    return graph
  }

  /** The closure tree `tree` made again, every node checked as when it was made. */
  private restoreClosures(tree: NonNullable<GraphData['closures']>) {
    if (!tree || typeof tree !== 'object' || !Array.isArray(tree.nodes))
      throw graphError('a saved graph lists its closure nodes as an array')
    for (const saved of tree.nodes) {
      if (!saved || typeof saved !== 'object')
        throw graphError('a saved closure node is not an object')
      const { id, ...node } = saved
      if (id !== this.closureNodes.length)
        throw graphError('a saved graph lists its closure nodes out of order')
      this.addClosureNode(node)
    }
    this.closures(tree.root)
  }
}
