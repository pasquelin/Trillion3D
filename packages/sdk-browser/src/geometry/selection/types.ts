import type { GeometryPageDescriptor } from '../../../../sdk-core/src/page/contracts.ts'
import type { DrawSource } from './drawSource.ts'
import type { PageSurface } from '../pages/surface.ts'
import type { DrawDistanceSettings } from '../../../../sdk-core/src/contracts/objectOptions.ts'
import type { MatrixElements } from '../../session/host/matrixElements.ts'
import type { CullingLinks } from '../cut/links.ts'
import type { PlacementOf } from '../../placement/rows/rows.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'

/** The box a dynamic page's vertices are in this frame (#573), local: its least then greatest
 *  corner (`../../session/world/pageMotion.ts`). */
export type MovedBox = { readonly min: number[]; readonly max: number[] }

/** Where a page's deformation results lie for a placement (`ClusterRoot.deformationOutputs`), in the
 *  float pool, `count` vertices of them from float `from`; `pool` names the geometry and placement
 *  world of a block shared by the pages of a geometry read as floats, none a page's own; `shared`
 *  marks the block of a page that every placement playing one bank track reads
 *  (`../../deformation/bankTracks.ts`). */
export type DeformationOutput = {
  from: number
  count: number
  pool?: { attributes: Geometry['attributes']; world?: MatrixElements }
  shared?: true
}

export type PageRec = {
  id: number
  url: string
  clusterId: string
  array?: Uint32Array
  triangles: number
  indexBytes: number
  /** Quantized cluster page of this cluster (`WGP3`, `docs/FORMAT.md`), when the compiler wrote
   *  one AND the cluster is opaque or masked: an engine that reads pages in place uploads these
   *  bytes instead of the index page and decodes every corner from them. Left undefined on a
   *  transparent cluster — its forward draw still reads an index buffer — and on a cache that
   *  carries no geometry page, both of which keep the source float buffers. */
  geometryPage?: GeometryPageDescriptor
  min: number[]
  max: number[]
  /** Where a dynamic page's vertices are this frame (#573), set by each rewrite its session takes
   *  (`frame/render/movedGeometry.ts`): every bound of its row — shadow sphere, occlusion
   *  corners, level-of-detail sphere — reads it in place of `min` and `max` grown by its root's
   *  `reach` (`rowBox`). Shared, as the record, by every placement: they draw the same vertices. */
  moved?: MovedBox
  role?: 'exact' | 'coarse'
  /** Flat DAG cut, copied from the page. Absent on caches without a per-cluster error. */
  level?: number
  /** The HLOD level of the actor a world page belongs to (`geometry/hlod/worldRecords.ts`, its
   *  cell's `actorLevel`); absent on a primitive's page, which draws itself. */
  hlodLayer?: number
  lodError?: number
  sphere?: number[]
  parentError?: number | null
  parentSphere?: number[] | null
  /** Group that replaces this cluster, and group that produced it. */
  group?: number | null
  source?: number | null
  /** Streaming bundle that carries this cluster, and its byte offset inside it. Residency is a
   *  property of the bundle: one request makes dozens of clusters drawable at once. */
  streamUrl?: string
  streamOffset?: number
  /** On a cluster of one of its primitive's ROOT PAGES (`streams.pinned`, as many as its mesh's
   *  `alwaysResidentKib` asks): the session's root cover holds it whatever the view
   *  (`../../frame/prepare/rootCover.ts`). */
  pinned?: true
  /** One record of each bundle its bundle is installed after, closed up to the root cover
   *  (`./bundleDependencies.ts`): a request for this record brings the missing ones with it. */
  dependencies?: readonly PageRec[]
  /** Coplanar depth layer, 0 for every cluster the compiler left alone. Always present, never
   *  undefined, so a page record keeps one shape through the selection loop. */
  depthLayer: number
  attributes: Geometry['attributes']
  /** The engine's own record of the surface this cluster wears (`../pages/surface.ts`). Every reader
   *  on the way to the image takes it from here and nothing else. */
  material: PageSurface
  /** The cluster's mesh has a distance field the scene holds, casts a dynamic shadow and affects distance-field
   *  lighting (`lighting/distanceField/representationWgsl.ts`): its row carries `FLAG_DISTANCE_FIELD`. */
  distanceField?: boolean
  transparent?: boolean
  /** What the page is drawn from: its attributes, declaration and node (`./drawSource.ts`). */
  drawSource?: DrawSource
  sourceOrder?: number
  renderOrder: number
  /** Rank of the request key, set once by `indexPageRequests`: deduplication without hashing. */
  requestIndex?: number
  /** The residency's key of the page: its rank in the host catalogue, set once. Residency and
   *  pinning without hashing. */
  keyIndex?: number
  /** On a cluster of an HLOD actor's root page — a root, or a cluster of the coarsest groups packed
   *  beside the roots —, the world bundle its cell holds it by: the cover holds it while that
   *  bundle is held (`../residency/coverHolders.ts`), never for the session. */
  holder?: number
}
/**
 * Group links of a primitive, flattened once and shared by every instance of it.
 *
 * `children` and `outputs` of a group cover the same surface, never both at once, so replacing one
 * by the other is always a complete swap. `sources` and `owners` say, for a cluster, which group
 * produced it and which group replaces it.
 */
export type ClusterStructureIndex = {
  groupCount: number
  childOffsets: Int32Array
  children: Int32Array
  outputOffsets: Int32Array
  outputs: Int32Array
  sources: Int32Array
  owners: Int32Array
  error: Float64Array
  sphere: Float64Array
  roots: readonly number[]
}
/**
 * One primitive instance as the selection sees it: its clusters, the world matrix that places them,
 * its flat culling hierarchy and its group links. There is no tree — every cluster carries its own
 * screen-error band, and the hierarchy is only a traversal accelerator.
 */
/** The surface a root's placement wears (`ClusterRoot.worn`), which the surface cache's cards are captured with. */
export type RootWorn = { surface: PageSurface }
/** The distances a root is drawn at, from the eye, in the scene's units: not drawn when the sphere
 *  of its bounds is wholly nearer than `min` or wholly farther than `max` — or, for a `perInstance`
 *  root, its bounds' centre —, a `max` of 0 naming none of its end. A root that names no distance
 *  carries none: `max` above 0, or `min` above 0 for a root that is no instance. */
export type DrawDistance = Readonly<Required<DrawDistanceSettings>>
/** The group that replaces the root of a placement that is an instance of an assembly — the levels
 *  above the instances' roots (`../dag/shader/rootParentWgsl.ts`) —: its error and the ball it is
 *  projected through, centre then radius, in the space of the placement's primitive. The cut opens
 *  the placement only while that error shows at the ball's distance: far away the group's own
 *  clusters draw in its stead. */
export type RootParent = Readonly<{
  error: number
  sphere: readonly [number, number, number, number]
}>
export type ClusterRoot<T> = {
  world: MatrixElements
  pages: T[]
  /** The packed rank of `pages[0]` in its engine's catalogue (#1235): every record is shared by
   *  all the placements of its primitive, so an instance — a (placement, page) pair — is named by
   *  its packed rank, and its root is the one the layout ranked here. Posted by the layout, read
   *  by the cut (`page/cut/take.ts`) to publish the instances as packed ranks. */
  packedBase?: number
  /** Compiled mesh number of its primitive (`Primitive.mesh`). */
  mesh?: number
  /** Whether its primitive was cut at run time (`Primitive.runtime`): it has no compiled cards, the surface cache makes them from its box. */
  runtime?: boolean
  /** The tree rays walk over its triangles (`Primitive.rayTracing`), shared by every placement of its primitive. */
  rayTracing?: import('../../../../sdk-core/src/lighting/rayTracingTree.ts').RayTracingTree
  /** Whether the material of its run-time primitive is double-sided (`Primitive.doubleSided`). */
  doubleSided?: boolean
  /** Its number in the mesh (`Primitive.primitive`): with `mesh`, the primitive the root places
   *  (`../../lighting/rays/sceneTrace/sceneTraceResources.ts`). */
  primitive?: number
  /** The primitive's culling hierarchy; `links`: parent of each node and leaf node of each
   *  cluster, derived once at prepare time and shared by its placements. */
  culling?: {
    nodes: Float64Array
    stride: number
    links?: CullingLinks
  }
  /** Root world box, six bounds flat (`packages/math/src/geometry/box.ts`), taken when read
   *  (`rootWorldBox`, `rootWorld.ts`): read through it, never directly. */
  worldBox?: Float64Array
  /** The local box of which `worldBox` is the image. Shared by every placement of the primitive,
   *  so it is read, never written. */
  localBox?: Float64Array
  /** The version its world moved at (`worldMoved`), and what the memos of its box and stretch were
   *  taken at (`rootWorld.ts`). */
  worldAt?: number
  boxAt?: number
  stretch?: number
  stretchAt?: number
  structure?: ClusterStructureIndex
  /** What the root declares of its pages' boxes, once and for all at prepare time: `true` says
   *  each carries `min` and `max`, and the cut then stops checking them per cluster under a node
   *  entirely inside the frustum. Absent or `false`, it tests every page as before. Whoever
   *  builds a page without a box declares nothing: that is the only contract that makes the
   *  omission visible. */
  boxes?: boolean
  /** True on a root whose pages are opaque and blended both — the world DAG, whose merged
   *  layers' sections wear their sources' materials (`../hlod/worldRecords.ts`): an opaque
   *  root, its blended pages drawn by the transparent pass, one item per blended surface
   *  (`rootBlends`, `collectBlend.ts`). */
  mixed?: boolean
  /** True while the row this root was collected from is parked, or its source node hidden: every
   *  cut skips the root, and its tables stay as they are, ready to be taken back
   *  (`placement/rows/rows.ts`, `placement/hidden.ts`). */
  parked?: boolean
  /** True while the host hides the source node or one of its ancestors (`placement/hidden.ts`). */
  hidden?: boolean
  /** Its mark, absent when 0: its surface's sprite bits (`spriteMark`), set at collection, and its
   *  casting bits (`castingMark.ts`) while its mesh or row casts no shadow or casts far ones
   *  (`followPlacementRows`, `followHostVisibility`). */
  mark?: number
  /** The distances it is drawn at, absent when it names none: the cut culls it outside them
   *  (`cutDrawDistanceCulling`, `../dag/shader/drawDistanceWgsl.ts`). */
  drawDistance?: DrawDistance
  /** The group that replaces its root, when it is an instance of an assembly, absent otherwise
   *  (`RootParent`). */
  rootParent?: RootParent
  /** The instance-buffer row this root reads its world from, when it was collected from one. */
  placement?: PlacementOf
  /** The results of each of its pages, by the page's rank in `pages`, where its deformation writes
   *  them (`../../deformation/outputs.ts`): its own, whatever the other placements of the primitive
   *  pose, or, while it plays a bank's track, the track's, which every placement playing it reads
   *  (`../../deformation/bankTracks.ts`); absent on a root that deforms nothing. */
  deformationOutputs?: (DeformationOutput | undefined)[]
  /** How far its primitive's deformation can move a vertex from rest (`Primitive.deformation`),
   *  absent on one that does not deform (#357). */
  deformation?: { joints: number[]; targets: number[]; softVertices?: number }
  /** How far its deformation moves a vertex this frame, in its units (`../../deformation/frame.ts`),
   *  and how far its surfaces' offsets may (`../../frame/render/offsetReach.ts`): absent or zero at
   *  rest. Their sum is `reach`, which every cut grows its bounds by (`holdReach`). */
  deformReach?: number
  offsetReach?: number
  reach?: number
  /** The surface its placement wears. */
  worn?: RootWorn
  /** Winding of `world` and the world version (`worldAt`) it was taken at
   *  (`frame/render/winding.ts`). */
  windingCw?: boolean
  windingEpoch?: number
}
