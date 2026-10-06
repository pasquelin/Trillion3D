import type { CookedBody } from '../../../sdk-core/src/physics/index.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { Model, ModelNode } from './tilePlace.ts'

/** The nodes a model's declared bodies stand for: each node whose body is made or on its way —
 *  its static tiles unwanted — counted by the bodies standing for it, each dynamic body's node,
 *  and the node each kinematic body a dynamic one carries follows. */
export type BodyNodes = {
  nodes: Map<number, number>
  moving: Map<CookedBody, ModelNode>
  carried: Map<CookedBody, Object3D>
}

/** The nodes whose static tiles `body` stands for: a dynamic one's subtree, else its node; and
 *  the node its collider names. */
function unwanted({ moving }: BodyNodes, body: CookedBody) {
  const own = moving.get(body)?.indices ?? [body.node]
  return body.colliderNode === undefined ? own : [...own, body.colliderNode]
}

/** `body`'s nodes unwanted (`by` 1) or wanted again (`by` -1), each counted by the bodies that
 *  stand for it: a body nested in a dynamic one's subtree keeps its node unwanted alone. */
export function countNodes(of: BodyNodes, body: CookedBody, by: 1 | -1) {
  for (const node of unwanted(of, body)) {
    const left = (of.nodes.get(node) ?? 0) + by
    if (left > 0) of.nodes.set(node, left)
    else of.nodes.delete(node)
  }
}

/** The nodes `model`'s `declared` bodies stand for, each counted once: a dynamic body moves its
 *  node where its model numbers it (`_nodeAt`), and a kinematic one inside that node's subtree
 *  follows its own node as the dynamic body moves it. */
export function bodyNodes(model: Model, declared: readonly CookedBody[]): BodyNodes {
  const of: BodyNodes = { nodes: new Map(), moving: new Map(), carried: new Map() }
  for (const body of declared) {
    const at = body.motion.isKinematic ? null : model._nodeAt?.(body.node)
    if (at) of.moving.set(body, at)
    countNodes(of, body, 1)
  }
  const moved = new Set([...of.moving.values()].flatMap((s) => s.indices))
  for (const body of declared) {
    if (!body.motion.isKinematic || !moved.has(body.node)) continue
    const own = model._nodeAt?.(body.node)
    if (own) of.carried.set(body, own.node)
  }
  return of
}
