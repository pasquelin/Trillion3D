import type { GraphNode } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { INPUT_HANDLERS } from './nodesInput.ts'
import { MATH_HANDLERS } from './nodesMath.ts'
import { TEXTURE_HANDLERS } from './nodesTexture.ts'
import type { State } from './state.ts'
import type { Value } from './value.ts'

const HANDLERS = { ...MATH_HANDLERS, ...INPUT_HANDLERS, ...TEXTURE_HANDLERS }

/** The value of `node` before its output's component mask: the handler of its kind. */
export function translateNode(state: State, node: GraphNode): Value {
  const handler = HANDLERS[node.kind]
  if (!handler) throw graphError(`${node.kind} cannot be compiled`, { node: node.id })
  return handler(state, node)
}
