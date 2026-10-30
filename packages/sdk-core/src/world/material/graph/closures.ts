import type { GraphStore, Pin } from './graph.ts'
import type { GraphOutput } from './outputs.ts'
import { graphError } from './valueType.ts'

/** The most closures a pixel holds: the surface record's closure offsets are eight entries of four bits. */
export const MAX_CLOSURES = 8
/** The most operators a closure tree holds, its leaves counted, a subtree that is blended into one closure counting as one. */
export const MAX_CLOSURE_OPERATORS = 15

/** The outputs that belong to one closure: what a slab leaf of the tree wires. The others (the opacity mask, the offsets, the
 *  shading model, the water and thin outputs) belong to the material and are wired on the graph. */
export const CLOSURE_OUTPUTS = [
  'baseColor',
  'metallic',
  'specular',
  'roughness',
  'emissive',
  'normal',
  'ambientOcclusion',
  'subsurfaceColor',
  'anisotropy',
  'tangent',
  'clearCoat',
  'clearCoatRoughness',
  'cloth',
  'clearCoatBottomNormal',
] as const satisfies readonly GraphOutput[]

/** The kinds of closure node. */
const CLOSURE_KINDS: readonly ClosureNode['kind'][] = [
  'slab',
  'horizontal',
  'vertical',
  'add',
  'weight',
]

/** The name of an output a closure owns. */
export type ClosureOutput = (typeof CLOSURE_OUTPUTS)[number]

/** A scalar an operator reads: a constant, or the wire of a one-component value. */
export type Operand = number | Pin

/**
 * A NODE OF A CLOSURE TREE, kept by its rank in the graph (`GraphStore.closureNodes`), children named by rank and made before their parent:
 * a slab leaf (the wires of its attributes), the horizontal mix of a background and a foreground by `mix` (the foreground's share), the
 * vertical layering of a top over a base, the sum of two closures, and the weight of one. `blend` asks the operator's subtree to be
 * blended into one closure (its parameters mixed) instead of kept as several.
 */
export type ClosureNode =
  | {
      readonly id: number
      readonly kind: 'slab'
      readonly attributes: Partial<Record<ClosureOutput, Pin>>
    }
  | {
      readonly id: number
      readonly kind: 'horizontal'
      readonly background: number
      readonly foreground: number
      readonly mix: Operand
      readonly blend: boolean
    }
  | {
      readonly id: number
      readonly kind: 'vertical'
      readonly top: number
      readonly base: number
      readonly blend: boolean
    }
  | {
      readonly id: number
      readonly kind: 'add'
      readonly a: number
      readonly b: number
      readonly blend: boolean
    }
  | {
      readonly id: number
      readonly kind: 'weight'
      readonly input: number
      readonly weight: Operand
    }

/** A node before it has a rank. */
export type ClosureNodeInput = ClosureNode extends infer N
  ? N extends unknown
    ? Omit<N, 'id'>
    : never
  : never

/** The leftmost slab of the tree rooted at `root`, the first leaf of the walk: the primary closure, which every pass that shades one
 *  closure reads. */
export function primarySlab(nodes: readonly ClosureNode[], root: number) {
  let node = nodes[root]
  while (node.kind !== 'slab') node = nodes[childrenOf(node)[0]]
  return node
}

/** The wires `graph` reads its outputs from: its own, and for a graph with a closure tree the primary slab's over them. */
export function closureOutputs(graph: GraphStore): Partial<Record<GraphOutput, Pin>> {
  return graph.closureRoot === undefined
    ? graph.outputs
    : { ...graph.outputs, ...primarySlab(graph.closureNodes, graph.closureRoot).attributes }
}

/** Whether any slab of the graph's tree (a member of a blended closure included), or the graph itself, wires the output `name`: a lobe
 *  any closure carries is one the surface has. */
export function wiresOutput(graph: GraphStore, name: GraphOutput) {
  if (graph.outputs[name]) return true
  return (
    graph.closureRoot !== undefined &&
    reachableSlabs(graph.closureNodes, graph.closureRoot).some(
      (slab) => slab.attributes[name as ClosureOutput],
    )
  )
}

/** Whether the child at rank `at` of `node` (the order of `childrenOf`) sits under the node's layering: the base of a vertical layering. */
export const isUnder = (node: ClosureNode, at: number) => node.kind === 'vertical' && at === 1

/**
 * Walks the tree rooted at `root`, each node before its children, a node reached twice twice: `visit(node, depth, under)` is given the node,
 * the number of vertical bases it sits under, and whether it sits under one (`depth > 0`).
 */
export function walkTree(
  nodes: readonly ClosureNode[],
  root: number,
  visit: (node: ClosureNode, depth: number, under: boolean) => void,
  depth = 0,
) {
  const node = nodes[root]
  visit(node, depth, depth > 0)
  childrenOf(node).forEach((child, at) =>
    walkTree(nodes, child, visit, depth + (isUnder(node, at) ? 1 : 0)),
  )
}

/** The slabs the tree rooted at `root` reaches. */
function reachableSlabs(nodes: readonly ClosureNode[], root: number) {
  const slabs: Extract<ClosureNode, { kind: 'slab' }>[] = []
  walkTree(nodes, root, (node) => {
    if (node.kind === 'slab') slabs.push(node)
  })
  return slabs
}

/** The children of `node`, in the order the tree is walked: the top before the base, the background before the foreground. */
export function childrenOf(node: ClosureNode): readonly number[] {
  switch (node.kind) {
    case 'slab':
      return []
    case 'horizontal':
      return [node.background, node.foreground]
    case 'vertical':
      return [node.top, node.base]
    case 'add':
      return [node.a, node.b]
    case 'weight':
      return [node.input]
  }
}

/** The scalar `node` reads, none for a node that reads none. */
export const operandOf = (node: ClosureNode): Operand | undefined =>
  node.kind === 'horizontal' ? node.mix : node.kind === 'weight' ? node.weight : undefined

/** The operands of `node` that are wires. */
export function operandPins(node: ClosureNode): readonly Pin[] {
  const operand = operandOf(node)
  return typeof operand === 'object' ? [operand] : []
}

/** Whether `pin` is a wire: a node and an output rank. */
const isPin = (pin: unknown): pin is Pin =>
  !!pin &&
  typeof pin === 'object' &&
  Number.isInteger((pin as Pin).node) &&
  Number.isInteger((pin as Pin).output)

/** Refuses a node of an unknown kind or shape, whose children are not nodes already made, whose operand is neither a finite number nor a
 *  wire, or whose slab names an output a closure does not own or a wire that is none. A node restored from a saved world is checked as one made. */
export function assertClosureNode(node: ClosureNodeInput, made: number) {
  const kind = (node as { kind?: unknown } | undefined)?.kind
  if (!CLOSURE_KINDS.includes(kind as ClosureNode['kind']))
    throw graphError('a closure node is of a kind that does not exist', { kind })
  const probe = { ...node, id: made } as ClosureNode
  if (probe.kind === 'slab') {
    if (
      !probe.attributes ||
      typeof probe.attributes !== 'object' ||
      Array.isArray(probe.attributes)
    )
      throw graphError('a slab lists its attributes as wires by output')
    for (const [name, pin] of Object.entries(probe.attributes)) {
      if (!(CLOSURE_OUTPUTS as readonly string[]).includes(name))
        throw graphError(`'${name}' is not an output a closure owns`, { output: name })
      if (!isPin(pin)) throw graphError(`the ${name} attribute of a slab is not a wire`)
    }
  }
  if ('blend' in probe && typeof probe.blend !== 'boolean')
    throw graphError('a closure operator says whether it blends with a boolean')
  for (const child of childrenOf(probe))
    if (!Number.isInteger(child) || child < 0 || child >= made)
      throw graphError('a closure operator names a closure that does not exist', { child })
  const operand = operandOf(probe)
  if (
    operand !== undefined &&
    (typeof operand === 'number' ? !Number.isFinite(operand) : !isPin(operand))
  )
    throw graphError('a closure operand is neither a number nor a wire')
}

/**
 * Refuses a tree whose root does not exist or that reaches a node twice. A closure operator or slab is registered once, as a node of the
 * tree: the reference refuses a node used from two places (one registration of an expression).
 */
export function assertClosureTree(nodes: readonly ClosureNode[], root: number) {
  if (!nodes[root]) throw graphError('the closure root does not exist', { root })
  const seen = new Set<number>()
  walkTree(nodes, root, (node) => {
    if (seen.has(node.id))
      throw graphError('a closure node is used more than once in the tree', { node: node.id })
    seen.add(node.id)
  })
}
