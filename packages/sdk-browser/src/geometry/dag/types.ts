import type { PlacementOf } from '../../placement/rows/rows.ts'
import type { GeometryPageDescriptor } from '../../../../sdk-core/src/page/contracts.ts'
import type { MatrixElements } from '../../session/host/matrixElements.ts'
import type { PageSurface } from '../pages/surface.ts'
import type {
  ClusterStructureIndex,
  DrawDistance,
  RootParent,
  RootWorn,
} from '../selection/types.ts'
import type { CullingLinks } from '../cut/links.ts'
import type { PlacementTree } from './placement/placementTree.ts'
import type { PackedWorld } from './worlds/worldLinks.ts'
import type { HeldOpen } from './heldOpen.ts'
import type { PlacementIndex } from '../selection/placements.ts'
import type { createRecordTable } from './pack/packRecords.ts'
import { CULLING_STRIDE } from '../../../../sdk-core/src/contracts/writtenFormats.ts'

/** Twenty words per node (`nodeLayout.ts`, `pack/packNodes.ts`): the manifest's box, ceiling,
 *  sphere, least own error and links, the placement word, then the open count, the kind and a pad
 *  word. */
export const DAG_NODE_FLOATS = 20,
  /** Numbers per node of the manifest's culling hierarchy (`page-codec-wasm/src/culling.rs`). */
  CULL_STRIDE = CULLING_STRIDE
/** A culling node's fields in its manifest row of `CULL_STRIDE` numbers: its box (min, max), its
 *  LOD sphere, its error ceiling, its least own error, its first child and child count, its first
 *  page and page count. */
export const CULL_MIN = 0,
  CULL_MAX = 3,
  CULL_SPHERE = 6,
  CULL_CEIL = 10,
  CULL_FLOOR = 11,
  CULL_FIRST_CHILD = 12,
  CULL_CHILD_COUNT = 13,
  CULL_FIRST_PAGE = 14,
  CULL_PAGE_COUNT = 15
/** Words of a placement's row of `frames`, the host's words (`frameTable.ts`): nothing is derived
 *  into it (`shader/primitiveWgsl.ts`). */
export const FRAME_ROW_WORDS = 10
type DagCluster = {
  url: string
  /** Its quantized page: with `url`, the content key the pool holds it under
   *  (`../rows/page/pageSlots.ts`, `pageAddress`). */
  geometryPage?: GeometryPageDescriptor
  lodError?: number
  parentError?: number | null
  sphere?: number[]
  parentSphere?: number[] | null
  level?: number
  min?: number[]
  max?: number[]
  material?: PageSurface
  /** Cluster triangles and its pass: the GPU holds the totals, the CPU does not sum them
   *  (`layout.ts`, snapshot header). */
  triangles?: number
  transparent?: boolean
}
export type DagRoot = {
  world: MatrixElements
  pages: DagCluster[]
  flat?: boolean
  /** A parked instance-buffer row: packed with the others, and deposited in no queue. */
  parked?: boolean
  /** The row the placement draws from, when it draws from one (`ClusterRoot.placement`): a row a
   *  partition placed knows its cell (`../partition/rowCells.ts`). */
  placement?: PlacementOf
  /** Its root mark (`ClusterRoot.mark`): one never culled takes planes no box leaves. */
  mark?: number
  /** The distances it is drawn at (`ClusterRoot.drawDistance`): none when absent. */
  drawDistance?: DrawDistance
  /** The group that replaces its root, when it is an instance of an assembly
   *  (`ClusterRoot.rootParent`): none when absent. */
  rootParent?: RootParent
  /** Its primitive's culling hierarchy, with its upward links when the host derived them, shared
   *  by every placement of the primitive (`../cut/links.ts`). */
  culling?: { nodes: Float64Array; stride: number; links?: CullingLinks }
  /** The local box its placements' world boxes are made of (`ClusterRoot.localBox`). */
  localBox?: Float64Array
  /** Group links: what the cut rule's residency is derived from (`../cut/readiness.ts`). */
  structure?: ClusterStructureIndex
  /** The world HLOD's alone (`geometry/hlod/worldHlod.ts`): each rank's HLOD cell, and each cell of the
   *  chain's parent (-1 for a top cell), layer, actor's flags (`CHAIN_ACTOR`) and the rows its
   *  actor places (`WorldRoots.rows`). */
  hlod?: {
    cells: Int32Array
    parent: Int32Array
    layer: Uint8Array
    actor: Uint8Array
    rows: Uint32Array
  }
}
/** What a placement's cut residency is derived from, and where its pages sit in the packing and
 *  its primitive's shared nodes in the node table (`readiness.ts`). */
export type DagCutLinks = {
  structure?: ClusterStructureIndex
  links: CullingLinks
  /** The deepest level a descent must reach once each page of the primitive is resident
   *  (`../hierarchy.ts`, `pageDepths`), shared by its placements; none reads as level 0. */
  depth?: Uint8Array
  pageBase: number
  pageCount: number
  nodeBase: number
  nodeCount: number
}
/** What placing a root reads again for the next placement of its primitive (`pack/pack.ts`): per node
 *  array its level sizes, and per page array its first placement's page base, record base, node
 *  array and root-cluster count. */
export type DagPackShared = {
  levelSizesOf: Map<Float64Array, readonly number[]>
  /** Per page array, the levels its pages need reached once resident (`pageDepths`). */
  depthsOf: Map<DagRoot['pages'], Uint8Array>
  firstOf: Map<
    DagRoot['pages'],
    {
      pageBase: number
      recordBase: number
      /** The first of the page array's cluster records (`info/clusterInfoLayout.ts`), one for each
       *  page of the array, shared by every placement of it. */
      infoBase: number
      nodes: Float64Array
      rootClusters: number
    }
  >
  /** Per node array, where its nodes lie in the node table — one copy for every placement of
   *  the primitive — and the node owning each of its pages there. */
  nodeBlocks: Map<Float64Array, { nodeBase: number; nodeCount: number; owner: Uint32Array }>
  /** The unique records written, which a page array of another source of a packed primitive is
   *  looked up in: its records are an earlier placement's when their words are the same. */
  records?: ReturnType<typeof createRecordTable>
}
export type PackedDag = {
  kind: 'dag'
  /** Hot records, one per UNIQUE cluster: placements of one primitive share theirs (`layout.ts`). */
  clusters: Float32Array
  nodes: Float32Array
  /** The cold words: the residency bits, the unique cold records, then the world's links
   *  (`layout.ts`, `worlds/worldLinks.ts`). */
  coldWords: Float32Array
  worlds: Float32Array
  /** Live double-precision placements; light selection reads them before camera rebasing rounds. */
  worldSources: readonly Pick<DagRoot, 'world'>[]
  /** Root node of each primitive, from which the level descent starts; `NO_INDEX` without. */
  rootNodes: Uint32Array
  /** Root node of each primitive, parked or not: what `rootNodes` takes back when a row returns. */
  rootBases: Uint32Array
  /** One per primitive: the word the kernel reads its mark from — its root's mark (`DagRoot.mark`)
   *  in the low sixteen bits, the deformation reach as a half float above (`rootMark`) —, as
   *  `markWorld` last wrote it, else the root's mark. */
  mark: Uint32Array
  /** Per placement, the distances it is drawn at (`DagRoot.drawDistance`, `DRAW_DISTANCE_STRIDE`
   *  floats each, all 0 for none: `drawDistanceAt`). Made by the first placement that names some:
   *  absent, none does and the cut tests no distance. */
  drawDistance?: Float32Array
  /** Where the node of each distinct group above an instance's root lies in the node table
   *  (`pack/packParents.ts`): the placements that read the same group share it. Kept by a packing
   *  that keeps no `shared` too: a group already placed is found at run time
   *  (`runtime/runtimeOps.ts`). */
  parentNodes: Map<string, number>
  /** Per placement, the node holding the error and the ball of the group that replaces its root
   *  (`DagRoot.rootParent`, `pack/packParents.ts`), `NO_INDEX` for none: made by the first
   *  placement that names one, absent while none does (`writePrimitiveWords`). */
  parentNode?: Uint32Array
  /** Nodes of each stage, all primitives together: the upper bound of each pass's queue. Its
   *  LENGTH is the depth of the deepest hierarchy, hence the number of descent passes; a second
   *  field to restate it would only be state to keep in agreement. */
  levelSizes: Uint32Array
  /** The packing's capacity — what every table is laid out for —: nodes, placements, pages. The
   *  live ones (`live`) lead each; those past them are inert, no root naming them (`pack/pack.ts`).
   *  Nodes are each primitive's ONCE, shared by its placements, then the placement tree's. */
  nodeCount: number
  /** The nodes one pass opens at most: a placement's entry for each of its primitive's nodes,
   *  every placement of the capacity, then the tree's nodes (`shader/levelWgsl.ts`). */
  entryCount: number
  worldCount: number
  pageCount: number
  /** The pages, nodes and placements its roots fill, from the first of each; the whole capacity
   *  when absent. */
  live?: { pages: number; nodes: number; worlds: number; entries: number; infos: number }
  /** What a later placement of a packed primitive reads to be appended in place
   *  (`appendDagRoots`): absent for a packing without room past its roots. */
  shared?: DagPackShared
  /** Unique records behind the `pageCount` pages, and the room kept for those a growth adds. */
  recordCount: number
  /** The cluster records (`info/clusterInfoLayout.ts`) behind the pages — one for each page of each
   *  distinct page array, which a source wearing another surface does not share with the records
   *  of the cut —, and the room kept for those a growth adds. */
  infoCount: number
  /** Nodes the primitives take, the room kept for a growth's included: the placement tree's follow. */
  primitiveNodeCount: number
  /** Each placement's first page, on the host alone: what names a page's placement
   *  (`rootOfPacked`); the kernels read it from the entries that carry it. */
  pageIndex: PlacementIndex
  /** Per placement, what its page index adds to reach its record, as a wrapping u32. */
  recordShift: Uint32Array
  /** Per placement, what its page index adds to reach its cluster record, as a wrapping u32. */
  infoShift: Uint32Array
  rootCount: number
  /** The url of page `page`, read from its placement's shared records: none stored per page. */
  pageUrlOf(page: number): string | undefined
  /** Per placement, its group and culling links (`readiness.ts`). */
  cutLinks: DagCutLinks[]
  /** The world DAG, when packed: its placements, each rank's HLOD cell, each placement's link to
   *  its HLOD 0 cell and each cell's state (`worlds/worldLinks.ts`). */
  world?: PackedWorld
  /** The cells and groups above the placements (`placement/placementTree.ts`), when they take one. */
  placementTree?: PlacementTree
  /** The open counts the placements hold of their own (`heldOpen.ts`), set by the readiness that
   *  keeps them (`readiness.ts`): none until one does. */
  heldOpen?: HeldOpen
  /** The levels the descent dispatches now (`encode.ts`): one past the deepest level a resident
   *  page needs reached (`DagCutLinks.depth`), its placement's tree levels above it counted, at
   *  most `levelSizes.length` and one at least. Set by the readiness that keeps the residency
   *  (`readiness.ts`): none until one does, every level then. */
  residentLevels?: () => number
}
