import {
  childrenOf,
  isUnder,
  walkTree,
  MAX_CLOSURE_OPERATORS,
  type ClosureNode,
  type Operand,
} from './closures.ts'
import { graphError } from './valueType.ts'

/** A factor that weighs a closure, met on the way from the root: a weight node's weight, a horizontal mix's foreground share (`mix`) or
 *  background share (`unmix`, one minus it). Each operand is held to 0..1 where it is evaluated. */
export interface WeightTerm {
  readonly kind: 'weight' | 'mix' | 'unmix'
  readonly value: Operand
}

/** One slab of a closure: its terms inside the closure when several slabs are blended, and whether it sits under a vertical layering of the blended subtree. */
export interface ClosureMember {
  readonly slab: number
  readonly terms: readonly WeightTerm[]
  readonly under: boolean
}

/**
 * A CLOSURE of the pixel: its coverage terms from the tree's root, the slabs it is made of (one, unless its subtree is blended into
 * it: the parameters of the members are then mixed by their terms), and the vertical layerings it is the base of, whose tops weigh it.
 */
export interface FlatClosure {
  /** The node the closure is: its slab, or the operator whose subtree is blended into it. */
  readonly root: number
  readonly terms: readonly WeightTerm[]
  readonly members: readonly ClosureMember[]
  /** The vertical layerings this one is the base of, the outermost first. Its coverage stays its own here: the reference keeps a base's coverage and
   * attenuates only its evaluation, the luminance weight by the top's coverage and throughput along the view and the
   *  top-layer data weight (`:415`), never the coverage that is stored. The closure writer reads these layerings for the weight it stores beside the coverage. */
  readonly layers: readonly VerticalLayer[]
}

/** A vertical layering a closure is the base of: the closures of its top, and how many of their terms lie outside the layering (the terms from the root to it; the rest are the top's own coverage). */
export interface VerticalLayer {
  readonly tops: readonly number[]
  readonly outside: number
}

/**
 * Whether the closure's coverage can differ from one: a term from the root that is not a weight of one. A closure alone that does is still kept
 * with its coverage, which weighs its light and its emission as the reference's coverage weighs a single BSDF's (its luminance weight,
 * SubstrateExport.ush:1122).
 */
export const carriesWeight = (closure: FlatClosure) =>
  closure.terms.some((term) => !(term.kind === 'weight' && term.value === 1))

export interface FlatClosures {
  readonly closures: readonly FlatClosure[]
  /** The operators kept, leaves counted. */
  readonly operators: number
}

/**
 * The closures of the tree `nodes` rooted at `root`, at most `limit`. A tree with more is simplified as the reference does: the
 * operators (vertical, horizontal, add) are ordered by how many vertical bases they sit under, then by rank, and the deepest and latest
 * is blended into one closure, again and again until the closures fit; an operator the node asked to blend (`blend`) is so from the start.
 * Closures are numbered in the order the tree is walked, the top before the base, the background before the foreground. The tree is the one
 * `assertClosureTree` accepted when the root was set.
 */
export function flattenClosures(
  nodes: readonly ClosureNode[],
  root: number,
  limit: number,
): FlatClosures {
  const blended = new Set<number>(nodes.filter((n) => 'blend' in n && n.blend).map((n) => n.id))
  const order: { id: number; depth: number }[] = []
  walkTree(nodes, root, ({ id, kind }, depth) => {
    if (kind === 'vertical' || kind === 'horizontal' || kind === 'add') order.push({ id, depth })
  })
  order.sort((a, b) => a.depth - b.depth || a.id - b.id)
  const build = () => walk(nodes, root, blended)
  let built = build()
  while (built.closures.length > limit && order.length) {
    blended.add(order.pop()!.id)
    built = build()
  }
  if (built.operators > MAX_CLOSURE_OPERATORS)
    throw graphError(
      `the closure tree holds ${built.operators} operators, at most ${MAX_CLOSURE_OPERATORS}`,
    )
  return { closures: built.closures, operators: built.operators }
}

/** The tree walked once with the operators of `blended` merged into closures. */
function walk(nodes: readonly ClosureNode[], root: number, blended: ReadonlySet<number>) {
  const closures: FlatClosure[] = []
  let operators = 0
  /** Collects the slabs under a blended operator, with their terms inside it. */
  const members = (
    id: number,
    terms: readonly WeightTerm[],
    under: boolean,
    out: ClosureMember[],
  ) => {
    const node = nodes[id]
    if (node.kind === 'slab') return void out.push({ slab: id, terms, under })
    for (const [at, [child, own]] of branches(node).entries())
      members(child, withTerm(terms, own), under || isUnder(node, at), out)
  }
  /** Walks outside any blended subtree; returns the closures the subtree made. */
  const visit = (
    id: number,
    terms: readonly WeightTerm[],
    layers: readonly VerticalLayer[],
  ): number[] => {
    const node = nodes[id]
    operators++
    if (node.kind === 'slab' || blended.has(id)) {
      const out: ClosureMember[] = []
      members(id, [], false, out)
      closures.push({ root: id, terms, members: out, layers })
      return [closures.length - 1]
    }
    if (node.kind === 'vertical') {
      const top = visit(node.top, terms, layers)
      return [...top, ...visit(node.base, terms, [...layers, { tops: top, outside: terms.length }])]
    }
    return branches(node).flatMap(([child, own]) => visit(child, withTerm(terms, own), layers))
  }
  visit(root, [], [])
  return { closures, operators }
}

/** The terms with the one a child adds, if it adds one. */
const withTerm = (terms: readonly WeightTerm[], own: WeightTerm | undefined) =>
  own ? [...terms, own] : terms

/** The children of `node` with the term each adds. */
function branches(node: ClosureNode): [number, WeightTerm | undefined][] {
  switch (node.kind) {
    case 'weight':
      return [[node.input, { kind: 'weight', value: node.weight }]]
    case 'horizontal':
      return [
        [node.background, { kind: 'unmix', value: node.mix }],
        [node.foreground, { kind: 'mix', value: node.mix }],
      ]
    default:
      return childrenOf(node).map((child) => [child, undefined])
  }
}
