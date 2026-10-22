import { NODE_SPECS } from './nodeSpecs.ts'
import type { GraphStore } from './graph.ts'
import { graphError } from './valueType.ts'

/** The words of a required input left unwired. */
export const missingInput = (kind: string, name: string) =>
  name === 'input' ? `Missing ${kind} input` : `Missing ${kind} input ${name}`

/** The texture coordinate sets a vertex carries. */
const TEXCOORD_SETS = 8

/**
 * Checks a graph the way compiling it needs: every required input wired (the node is named), every
 * texture node holding a texture or reading one by its wire, every parameter named, every texture
 * coordinate set below `TEXCOORD_SETS`. A graph with an output wired to nothing it can read was
 * refused when the wire was made.
 */
export function validateGraph(graph: GraphStore) {
  for (const node of graph.nodes) {
    const { kind, id, props } = node
    for (const name of NODE_SPECS[kind].required)
      if (!node.inputs[name]) throw graphError(missingInput(kind, name), { node: id, kind })
    if ((kind === 'textureObject' || kind === 'textureParameter') && !graph.textures.has(id))
      throw graphError(`${kind} requires a texture`, { node: id })
    if (kind === 'textureSample' && !graph.textures.has(id) && !node.inputs.texture)
      throw graphError('Missing input texture', { node: id })
    if (/Parameter$/.test(kind) && typeof props.name === 'string' && !props.name)
      throw graphError(`${kind} needs a name`, { node: id })
    for (const key of ['index', 'constCoordinate'])
      if (typeof props[key] === 'number' && (props[key] < 0 || props[key] >= TEXCOORD_SETS))
        throw graphError(`only ${TEXCOORD_SETS} texture coordinate sets exist`, { node: id })
  }
}
