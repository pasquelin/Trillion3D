// The world DAG the cook publishes (`worldRootsDag`), read through the runtime's `worldRootDag` in
// the shape the cut rule's fixtures read (`RuleDag`): shared by the world's proofs.
import { worldRootDag } from './worldHlod.ts'
import { worldRootPages } from './worldRootPages.ts'
import { worldBinary, worldRootsDag } from './worldRootsPages.fixture.ts'
import type { RuleDag } from '../cut/cutRule.fixture.ts'
import { cullingBounds } from '../cut/bounds.ts'

/** The world DAG the cook publishes, as the runtime reads it (`worldRootDag`), with the group that
 *  replaces each cluster and the leaf units it covers attached, so a coverage check can read them. */
export function worldDag() {
  const cooked = worldRootsDag(),
    { clusters, groups, leaves } = cooked
  const root = worldRootDag(
    { clusters, groups, culling: cooked.culling, ...worldBinary() },
    worldRootPages,
  )!
  // The group that replaces each cluster in the structure the runtime reads (`cellTopGroups`).
  const owner = Array.from(root.structure!.owners, (group) => (group < 0 ? null : group))
  // The cut's `RulePage` reads a world page as the runtime reads it, the cook's fields beside: a
  // cluster carries no manifest `source`, and its `primitive` names the primitive it wears, not a
  // surface.
  const pages = root.pages.map((page, at) => ({
    ...clusters[at],
    ...page,
    group: owner[at],
    source: null,
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
