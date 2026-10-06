// The world DAG the cook publishes (`worldRootsDag`), read through the runtime's `worldRootDag` in
// the shape the cut rule's fixtures read (`RuleDag`): shared by the super-root and mirror proofs.
import { worldRootDag } from './worldSuperRoots.ts'
import { worldRootPages } from './worldPageServe.ts'
import { worldRootsDag } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import type { RuleDag } from '../page/cut/cutRule.fixture.ts'
import { cullingBounds } from '../page/cut/bounds.ts'

/** The world DAG the cook publishes, as the runtime reads it (`worldRootDag`), with the group that
 *  replaces each cluster and the leaf units it covers attached, so a coverage check can read them. */
export function worldDag(): RuleDag & { origins: Int32Array } {
  const { clusters, groups, leaves } = worldRootsDag()
  const owner = new Array<number | null>(clusters.length).fill(null)
  for (const [at, group] of groups.entries()) for (const child of group.children) owner[child] = at
  const root = worldRootDag(
    { clusters, groups, payload: { url: 'world-roots.bin' } },
    worldRootPages,
  )!
  // The cut's `RulePage` reads a world page as the cook names it: a cluster carries no manifest
  // `source`, and its `material` is a manifest index, not the surface `DagCluster` holds.
  const pages = root.pages.map((page, at) => ({
    ...page,
    ...clusters[at],
    group: owner[at],
    source: null,
    material: undefined,
  })) as RuleDag['pages']
  const culling = {
    ...root.culling!,
    bounds: cullingBounds(root.culling!, pages),
  } as RuleDag['culling']
  // The cut's `RuleDag` reads the world's sixteen floats as a `Float64Array`; the runtime's world
  // matrix is the identity, read host by host (`MatrixElements`).
  const world = { elements: Float64Array.from(root.world.elements) }
  return { ...root, structure: root.structure!, pages, culling, world, leaves }
}
export type WorldDag = ReturnType<typeof worldDag>

/** The drawn page covering leaf unit `unit`, or -1 when none covers it. */
export function coverAt(dag: WorldDag, drawn: readonly number[], unit: number) {
  for (const page of drawn) {
    const [a, b] = dag.pages[page].units
    if (a <= unit && unit < b) return page
  }
  return -1
}
