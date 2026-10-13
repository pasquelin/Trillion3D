// What the packing's append proofs share: five placements of one pyramid, and the tables a
// packing is compared by.
import * as G from '../../host/graph/graph.fixture.ts'
import { dagRootCounts, type DagCapacity } from './pack.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
import type { DagRoot } from './types.ts'

/** Five placements of one pyramid along x, the last three parked as a growth leaves its rows. */
export function scene() {
  const pages = scenePages(256, 4)
  const worlds = [0, 1, 2, 3, 4].map((k) => new G.Matrix4().makeTranslation(k * 3, 0, 0))
  const roots: DagRoot[] = sceneRoots(pages, worlds)
  const counts = dagRootCounts(roots)
  const capacity: DagCapacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 8 }
  return { roots, counts, capacity }
}

export const TABLES = [
  'clusters',
  'nodes',
  'pageCones',
  'worlds',
  'worldStretch',
  'rootNodes',
  'rootBases',
  'mark',
  'recordShift',
  'levelSizes',
] as const
