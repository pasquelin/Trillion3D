import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts'
import type { MatrixElements } from '../../math/matrixElements.ts'
import type { NormalCone } from '../../page/cone/cone.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { SelectionUniforms } from '../core/selection.ts'
import type { ClusterStructureIndex } from '../../page/selection/types.ts'
import type { CullingLinks } from '../../page/cut/links.ts'

/** The view one run of the kernel serves: the camera's uniforms. */
export type DagViewUniforms = SelectionUniforms

/** Twenty-four floats per node: the sixteen from the manifest, then the subtree error-floor
 *  sphere, the floor and a flags word (`packNodes.ts`). */
export const DAG_NODE_FLOATS = 24,
  FRAME_VEC4 = 7,
  CULL_STRIDE = 15
/** Vec4s per primitive a camera cut's `dagPrepare` derives behind the first row of `frames`
 *  (`shader/primitiveWgsl.ts`): its `view · world`, its prepared normal matrix, and the view
 *  ahead's planes and `view · world`. */
export const PRIMITIVE_VEC4 = 17
type DagCluster = {
  url: string
  /** Its quantized page: with `url`, the content key the pool holds it under (`evict.ts`). */
  geometryPage?: GeometryPageDescriptor
  lodError?: number
  parentError?: number | null
  sphere?: number[]
  parentSphere?: number[] | null
  level?: number
  min?: number[]
  max?: number[]
  cone?: NormalCone
  material?: PageSurface
  /** Cluster triangles and its pass: the GPU holds the totals, the CPU no longer sums them
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
  /** Its root mark (`ClusterRoot.mark`): a root its impostor card draws opens no descent, one never
   *  culled takes planes no box leaves. */
  mark?: number
  /** `bounds`: per-node bounds `cullingBounds` derives from the pages. The host shares them
   *  among all placements of a primitive; without them, the layout derives them itself. */
  culling?: { nodes: Float64Array; stride: number; bounds?: Float64Array; links?: CullingLinks }
  /** Group links: what the cut rule's residency is derived from (`../../page/cut/readiness.ts`). */
  structure?: ClusterStructureIndex
  /** The world DAG's alone (`scene/worldSuperRoots.ts`): per rank, the table object an object
   *  root mirrors, -1 for a super-root (#1332). */
  origins?: Int32Array
}
/** What a placement's cut residency is derived from, and where its pages and nodes sit in the
 *  packing (`readiness.ts`). */
export type DagCutLinks = {
  structure?: ClusterStructureIndex
  links: CullingLinks
  pageBase: number
  pageCount: number
  nodeBase: number
  nodeCount: number
}
export type PackedDag = {
  kind: 'dag'
  /** Hot records, one per UNIQUE cluster: placements of one primitive share theirs (`layout.ts`). */
  clusters: Float32Array
  nodes: Float32Array
  /** Working table (one placement word per page), residency bits, then the unique cold records. */
  pageCones: Float32Array
  worlds: Float32Array
  /** Live double-precision placements; light selection reads them before camera rebasing rounds. */
  worldSources?: readonly Pick<DagRoot, 'world'>[]
  worldStretch: Float32Array
  /** Root node of each primitive, from which the level descent starts; `SELECTION_NONE` without. */
  rootNodes: Uint32Array
  /** Root node of each primitive, parked or not: what `rootNodes` takes back when a row returns. */
  rootBases: Uint32Array
  /** One per primitive: the word the kernel reads its mark from — its root's mark (`DagRoot.mark`)
   *  in the low sixteen bits, the deformation reach as a half float above (`markReach`) —, as
   *  `markWorld` last wrote it, else the root's mark. */
  mark: Uint32Array
  /** Nodes of each stage, all primitives together: the upper bound of each pass's queue. Its
   *  LENGTH is the depth of the deepest hierarchy, hence the number of descent passes; a second
   *  field to restate it would only be state to keep in agreement. */
  levelSizes: Uint32Array
  nodeCount: number
  worldCount: number
  pageCount: number
  /** Unique records behind the `pageCount` pages. */
  recordCount: number
  /** Per placement, what its page index adds to reach its record, as a wrapping u32. */
  recordShift: Uint32Array
  rootCount: number
  /** The url of page `page`, read from its placement's shared records: none stored per page. */
  pageUrlOf(page: number): string | undefined
  /** Per placement, its group and culling links (`readiness.ts`). */
  cutLinks: DagCutLinks[]
  /** The world DAG, when packed (#1333): its placement and its `origins`, which the cut's
   *  residency mirrors (`worldMirror.ts`, #1332). */
  world?: { root: number; origins: Int32Array }
}
