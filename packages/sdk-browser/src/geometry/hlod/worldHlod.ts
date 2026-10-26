/**
 * THE WORLD'S HLOD AS THE ONE CUT READS IT.
 *
 * The cook builds each HLOD cell's actor of the next layer up to its chain's top, one mesh per cell
 * and material (`world-roots.dag`, docs/FORMAT.md, World HLOD). This module turns that world DAG
 * into the engine's own shape — one `DagRoot` with a single `ClusterStructureIndex` and one
 * culling hierarchy — so the existing cut (`geometry/cut/rule.ts`, the selection shader
 * `geometry/dag/shader/shader.ts`) cuts it as any primitive, each cluster drawn only while its HLOD
 * cell draws its actor (`geometry/dag/worlds/worldLinks.ts`): no second selection path and no second BVH
 * (rule 7), its hierarchy the cook's.
 *
 * An actor built without a cluster DAG — a merged, approximated or simplified mesh by default —
 * is its level 0 alone: every cluster a root, no group, every error 0. It is drawn as a plain mesh
 * is, whole at every distance: `cellTopGroups` joins the roots of one cell into one group, so
 * none is drawn while another is not resident and the cut finds nothing to refine in them.
 *
 * The world pages are world-space geometry (`worldRootsPage`): the root's world matrix is the
 * identity, and the pages' `min`/`max`/`sphere` are their own world-space bounds. The
 * DAG is read in the cook's own cluster order, never re-sorted: a cluster out of
 * its rank is refused, `WORLD_CLUSTER_RANK`, since the groups name clusters by rank.
 */

import type { DagRoot } from '../dag/types.ts'
import type { ClusterGroup, CullingHierarchy } from '../../../../sdk-core/src/contracts/geometry.ts'
import type {
  WorldRoots,
  WorldRootsBundle,
  WorldRootsCluster,
} from '../../../../sdk-core/src/manifest/worldRoots.ts'
import { structureIndex } from '../selection/structure.ts'
import { cullingNodes } from '../selection/helpers.ts'
import { cullingLinks } from '../cut/links.ts'
import { IDENTITY_WORLD } from '../../session/host/matrixElements.ts'
import type { worldRootPages } from './worldRootPages.ts'
import { sphereUnion } from '../../../../math/src/geometry/sphere.ts'
import { entryOf } from '../../../../math/src/sequence/counts.ts'

/** The `clusters`, `groups` and `culling` hierarchy of a world-roots DAG. A group's `children` and
 *  `outputs` name clusters by rank, the rank of the hierarchy's order (`merge.rs`,
 *  `in_culling_order`), whose nodes name ranges of ranks. `chain` is the table's chain of HLOD
 *  cells (`WorldRoots.chain`). */
export type WorldRootsDagTable = {
  clusters?: readonly WorldRootsCluster[]
  groups?: ClusterGroup[]
  culling?: CullingHierarchy
  /** The binary's resolved address, which every page address starts with: two worlds' pages never
   *  share one (`geometryPageAddress`). */
  url: string
  chain: Pick<WorldRoots['chain'], 'parent' | 'level' | 'actorLevel' | 'actor'>
  /** Each bundle's offset in the binary: where its pages lie (`geometryPageAddress`). */
  bundles: readonly Pick<WorldRootsBundle, 'offset'>[]
  /** Each HLOD cell's root pages (`WorldRoots.hlod`): what it holds while its actor is loaded. */
  hlod: WorldRoots['hlod']
  /** How many rows each HLOD cell's actor places (`WorldRoots.rows`): what its readiness counts
   *  beside its roots. */
  rows: Pick<WorldRoots['rows'], 'count'>
}

/** The world clusters as `worldRootPages` names them: what the cut projects, the primitive each
 *  wears, its page and that page's facts. */
type WorldPages = ReturnType<typeof worldRootPages>['pages']

/** The world DAG as the one cut reads it: a `DagRoot` over its pages, each rank's HLOD cell,
 *  the roots each bundle holds for its cell, and each rank's bundle. */
export type WorldDagRoot = Omit<DagRoot, 'pages' | 'culling' | 'hlod'> & {
  pages: WorldPages
  /** Its hierarchy with the bounds and links made once (`worldRootDag`). */
  culling?: Required<NonNullable<DagRoot['culling']>>
  hlod: NonNullable<DagRoot['hlod']>
  held: ReadonlyMap<number, readonly number[]>
  /** Each rank's bundle, -1 for a rank without a page (`worldRootPages.ts`). */
  bundleOf: Int32Array
}

/**
 * The world `DagRoot` of a world-roots table (world-space, identity matrix): its clusters in their
 * cook rank, a `ClusterStructureIndex` from its groups, and the culling hierarchy the cook built
 * over them (`worldRootPages`). A page is named by the binary's resolved `url` and its
 * `bundle`/`offset`. The clusters nothing replaces are the structure's roots; each lies in one of
 * its actor's root pages — its roots, then its coarsest groups whole, the pages its cell lists —,
 * whose every cluster is `held` by that bundle, its `holder`, resident while its HLOD cell holds
 * it (`../../../../asset-compiler-rust/src/hlod/chain/bundles.rs`). `hlod` names, per rank, its
 * HLOD cell.
 */
export function worldRootDag(
  table: WorldRootsDagTable,
  pagesOf: typeof worldRootPages,
): WorldDagRoot | undefined {
  // A chain of no cell switches nothing. One whose actors are all rows (`WorldRoots.rows`) is a DAG
  // of no cluster, its hierarchy one empty node: packed all the same, it carries the switch.
  const { clusters = [], groups = [] } = table
  if (!table.chain.parent.length) return undefined
  // The cook writes every world's hierarchy (since version 6): a DAG without one is refused when
  // read.
  const { roots, held, pages, hlod, bundleOf } = pagesOf(
    clusters,
    table.url,
    table.bundles,
    table.chain.actorLevel,
    table.hlod,
  )
  const structure = structureIndex(
    { version: 1, roots, groups: cellTopGroups(groups, roots, pages, hlod) },
    pages.length,
  )
  const nodes = cullingNodes(table.culling, pages.length)
  return {
    world: IDENTITY_WORLD,
    pages,
    structure,
    // Its hierarchy with its links, made once here as a primitive's template makes its own
    // (`geometry/selection/template.ts`): every reader takes them, none derives them again.
    culling: nodes && { ...nodes, links: cullingLinks(nodes, pages.length) },
    // Each rank's HLOD cell, whose switch shows it, and the chain (`geometry/dag/worlds/worldLinks.ts`).
    hlod: {
      cells: hlod,
      parent: table.chain.parent,
      layer: table.chain.level,
      actor: table.chain.actor,
      rows: table.rows.count,
    },
    held,
    bundleOf,
  }
}

/**
 * The cook's `groups` with, per HLOD cell (`cells`, a rank's), the roots of its actor that wear a
 * page made the outputs of ONE group, behind the others: the groups whose outputs are all such roots
 * — the top of each DAG its actor holds, one a section — joined, and a root no group produced — a
 * section of one cluster — given to it as an output. A root a group outputs beside clusters a
 * coarser group replaces — a group the build stalled above — keeps its group: its members are its
 * replacement, which another group's readiness would misname. The roots of one actor then stand in together
 * and refine together (`../cut/readiness.ts`, `rootsResident`): none is drawn while another is
 * not resident, whatever its surface. A blended section's page is resident with its bytes, an
 * opaque one's only once it also holds a row (`../rows/slotOps.ts`): apart, a curtain wall
 * would be drawn before the core it wraps. Each root and each member keeps its own error, so each
 * still switches at its own threshold (`../cut/rule.ts`); a root no group produced draws as it
 * did once its group is ready, its own error alone. A root without a page is never resident: left
 * out, it holds no actor back.
 */
function cellTopGroups(
  groups: readonly ClusterGroup[],
  roots: readonly number[],
  pages: WorldPages,
  cells: ArrayLike<number>,
): ClusterGroup[] {
  const owned = new Uint8Array(pages.length),
    produced = new Uint8Array(pages.length)
  for (const group of groups) {
    for (const child of group.children) owned[child] = 1
    for (const output of group.outputs) produced[output] = 1
  }
  const cellOf = ({ outputs }: ClusterGroup) => {
    const cell = outputs.length ? cells[outputs[0]] : -1
    const top = outputs.every((at) => !owned[at] && pages[at].url && cells[at] === cell)
    return top ? cell : -1
  }
  const kept: ClusterGroup[] = [],
    tops = new Map<number, { groups: ClusterGroup[]; alone: number[] }>()
  const newTop = () => ({ groups: [] as ClusterGroup[], alone: [] as number[] })
  const topOf = (cell: number) => entryOf(tops, cell, newTop)
  for (const group of groups) {
    const cell = cellOf(group)
    if (cell < 0) kept.push(group)
    else topOf(cell).groups.push(group)
  }
  for (const root of roots)
    if (!produced[root] && pages[root].url) topOf(cells[root]).alone.push(root)
  for (const { groups: top, alone } of tops.values())
    if (top.length + alone.length < 2) kept.push(...top)
    else kept.push(joined(top, alone, pages))
  return kept
}

/** One group of the groups `top` and the roots `alone`: the groups' members, their outputs and the
 *  roots, the largest error and level, the ball around every group's and root's. */
function joined(top: readonly ClusterGroup[], alone: readonly number[], pages: WorldPages) {
  const sphere = new Float64Array([0, 0, 0, -1])
  for (const group of top) sphereUnion(sphere, 0, group.sphere, 0)
  for (const root of alone) sphereUnion(sphere, 0, pages[root].sphere, 0)
  return {
    level: Math.max(0, ...top.map((group) => group.level)),
    error: Math.max(0, ...top.map((group) => group.error)),
    sphere: Array.from(sphere),
    children: top.flatMap((group) => group.children),
    outputs: [...top.flatMap((group) => group.outputs), ...alone],
  } satisfies ClusterGroup
}
