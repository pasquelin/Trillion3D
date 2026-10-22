import { EngineError } from '../../../contracts/cache.ts'
import type { Texture } from '../../texture/texture.ts'
import { InputGraph } from './inputs.ts'
import type { GraphData } from './graph.ts'
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
    for (const [name, value] of Object.entries(data.values ?? {})) graph.set(name, value)
    return graph
  }

  /** A copy: the same nodes, wires, textures and parameter values. */
  clone() {
    const graph = new MaterialGraph(this.domain)
    for (const node of this.nodes)
      graph.addNode(node.kind, node.props, node.inputs, this.textures.get(node.id))
    for (const [name, pin] of Object.entries(this.outputs)) graph.output(name, pin)
    for (const [name, value] of this.values) graph.set(name, value)
    return graph
  }
}
