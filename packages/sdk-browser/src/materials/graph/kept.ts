import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'

/**
 * WHAT COMPILING A GRAPH GAVE, KEPT: a pass compiles the graph a surface, a volume or a light function
 * wears once for each shape of the graph (a value written to a parameter compiles nothing again),
 * and keeps the answer — the program, or the refusal naming the node — for as long as the graph
 * lives. A refusal is named once by the frame (`takeGraphRefusals`) and its owner is drawn from its
 * parameters, as an owner with no graph is.
 */
export interface GraphRefusal {
  readonly error: string
}

/** The words of an error thrown while a graph was compiled. */
export const refusalText = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/** The refusals made since they were last taken, once each (`takeGraphRefusals`). */
const refused: string[] = []

/** A graph a pass could not compile: named with the others. */
export const refuseGraph = (error: unknown) => void refused.push(refusalText(error))

/** The refusals made since the last call: what the frame names once (`material-graph-refused`). */
export const takeGraphRefusals = () => refused.splice(0)

/** Whether `made` is a refusal. */
export const isRefusal = (made: unknown): made is GraphRefusal =>
  !!made && typeof made === 'object' && 'error' in made

const held = new WeakMap<MaterialGraph, Map<string, { shape: number; made: unknown }>>()

/**
 * What `make` compiles of `graph` under the name `key` (what it is compiled for: the pass, the
 * blend), made at the first ask and again only when the graph's shape changes; the refusal `make`
 * threw, naming the node, where it does not compile — named with the others (`refuseGraph`) unless
 * `named` is false, the pass naming its own.
 */
export function compileKept<T>(
  graph: MaterialGraph,
  key: string,
  make: () => T,
  named = true,
): T | GraphRefusal {
  let slots = held.get(graph)
  if (!slots) held.set(graph, (slots = new Map()))
  const last = slots.get(key)
  if (last?.shape === graph.shape) return last.made as T | GraphRefusal
  let made: T | GraphRefusal
  try {
    made = make()
  } catch (error) {
    made = { error: refusalText(error) }
    if (named) refuseGraph(error)
  }
  slots.set(key, { shape: graph.shape, made })
  return made
}
