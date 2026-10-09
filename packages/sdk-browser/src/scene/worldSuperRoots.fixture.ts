// The world DAG the cook publishes (`worldRootsDag`), read through the runtime's `worldRootDag` in
// the shape the cut rule's fixtures read (`RuleDag`): shared by the super-root and mirror proofs.
import { worldRootDag } from './worldSuperRoots.ts'
import { worldRootPages } from './worldPageServe.ts'
import { worldPage, worldRootsDag } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import type { RuleDag } from '../page/cut/cutRule.fixture.ts'
import { cullingBounds } from '../page/cut/bounds.ts'

type Cooked = ReturnType<typeof worldRootsDag>

/**
 * Object `u` alone in a cell of its own, as the cook leaves one (`compiler_world_roots/world.rs`):
 * its object root, and the group of its own whose outputs are two copies of it, its halves at its
 * error and sphere — roots of the world past the pinned top (bundle 0), in its cell's `bundle`.
 */
export function standAlone({ clusters, groups }: Cooked, u: number, bundle: number) {
  const [lodError, sphere, object] = [0.05, [u + 0.5, 0, 0, 0.5], clusters.length]
  /** A cluster of object `u` over `[from, to)` along x, at its error and sphere. */
  const part = (level: number, from: number, to: number) => ({
    cluster: clusters.length,
    level,
    lodError,
    sphere,
    min: [from, -0.25, -0.25],
    max: [to, 0.25, 0.25],
    triangles: 2,
    primitive: 0,
    units: [u, u + 1] as [number, number],
  })
  const placed = { parentError: lodError, parentSphere: sphere, origin: u }
  clusters.push({ ...part(0, u, u + 1), ...placed, bundle: null, offset: null, page: null })
  const outputs = [0, 1].map((half) => {
    const { facts } = worldPage(u + half / 2),
      copy = part(1, u + half / 2, u + (half + 1) / 2)
    const page = { bundle, offset: half * facts.bytes, page: facts }
    clusters.push({ ...copy, parentError: null, parentSphere: null, origin: null, ...page })
    return copy.cluster
  })
  groups.push({ level: 1, error: lodError, sphere, children: [object], outputs })
}

/** The world DAG the cook publishes, as the runtime reads it (`worldRootDag`), with the group that
 *  replaces each cluster and the leaf units it covers attached, so a coverage check can read them;
 *  past its cells, `alone` objects each standing alone (`standAlone`). Its top, bundle 0, is
 *  pinned. */
export function worldDag(alone = 0): RuleDag & { origins: Int32Array } {
  const cooked = worldRootsDag(),
    { clusters, groups } = cooked
  for (let at = 0; at < alone; at++) standAlone(cooked, cooked.leaves + at, 4 + at)
  const leaves = cooked.leaves + alone
  const owner = new Array<number | null>(clusters.length).fill(null)
  for (const [at, group] of groups.entries()) for (const child of group.children) owner[child] = at
  const root = worldRootDag(
    { clusters, groups, payload: { url: 'world-roots.bin' }, pinned: 1 },
    worldRootPages,
  )!
  // The cut's `RulePage` reads a world page as the cook names it: a cluster carries no manifest
  // `source`, and its `primitive` names the primitive it wears, not a surface.
  const pages = root.pages.map((page, at) => ({
    ...page,
    ...clusters[at],
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
export type WorldDag = ReturnType<typeof worldDag>

/** The drawn page covering leaf unit `unit`, or -1 when none covers it. */
export function coverAt(dag: WorldDag, drawn: readonly number[], unit: number) {
  for (const page of drawn) {
    const [a, b] = dag.pages[page].units
    if (a <= unit && unit < b) return page
  }
  return -1
}
