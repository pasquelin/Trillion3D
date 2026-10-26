import { NODE_SPECS, NOISE_FUNCTIONS } from './nodeSpecs.ts'
import type { GraphNode, GraphStore } from './graph.ts'
import { graphError } from './valueType.ts'

/** The words of a required input left unwired. */
export const missingInput = (kind: string, name: string) =>
  name === 'input' ? `Missing ${kind} input` : `Missing ${kind} input ${name}`

/** The texture coordinate sets a vertex carries. */
const TEXCOORD_SETS = 8

/**
 * Checks a graph the way compiling it needs: every required input wired (the node is named), every
 * texture node holding a texture or reading one by its wire, every parameter named, every texture
 * coordinate set below `TEXCOORD_SETS`, every noise naming one of its functions, every desaturation
 * weighing three channels. A graph with an output wired to nothing it can read was refused when the
 * wire was made.
 */
export function validateGraph(graph: GraphStore) {
  for (const node of graph.nodes) {
    const { kind, id } = node
    for (const name of NODE_SPECS[kind].required)
      if (!node.inputs[name]) throw graphError(missingInput(kind, name), { node: id, kind })
    validateTexture(graph, node)
    validateProps(node)
  }
}

/** A texture node holds a texture or reads one by its wire. */
function validateTexture(graph: GraphStore, node: GraphNode) {
  const { kind, id } = node
  if ((kind === 'textureObject' || kind === 'textureParameter') && !graph.textures.has(id))
    throw graphError(`${kind} requires a texture`, { node: id })
  if (kind === 'textureSample' && !graph.textures.has(id) && !node.inputs.texture)
    throw graphError('Missing input texture', { node: id })
}

/** A node's own settings: its noise function, desaturation weights, parameter name and coordinate set. */
function validateProps(node: GraphNode) {
  const { kind, id, props } = node
  if (kind === 'noise' && !(NOISE_FUNCTIONS as readonly unknown[]).includes(props.noiseFunction))
    throw graphError(`noise has no function '${String(props.noiseFunction)}'`, { node: id })
  if (kind === 'desaturation' && (props.luminance as readonly number[]).length !== 3)
    throw graphError('desaturation weighs three channels', { node: id })
  if (/Parameter$/.test(kind) && typeof props.name === 'string' && !props.name)
    throw graphError(`${kind} needs a name`, { node: id })
  for (const key of ['index', 'constCoordinate'])
    if (typeof props[key] === 'number' && (props[key] < 0 || props[key] >= TEXCOORD_SETS))
      throw graphError(`only ${TEXCOORD_SETS} texture coordinate sets exist`, { node: id })
}
