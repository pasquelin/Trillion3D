/** Cut result, filled in place: the caller supplies the object, the image allocates none. */
export interface SelectionResult<T> {
  shown: T[]
  wanted: T[]
  /** The instances as packed catalogue ranks, parallel to `shown` and `wanted` rank by rank: the
   *  identity the engines' consumers route by (a packed rank is the engine's per-placement page),
   *  resolved back to a record through the catalogue (`recordOf(packed)`). Reused `Int32Array`s,
   *  widened as the cut emits (`fitPacked`, #1232); their live ranks are those of `shown` and
   *  `wanted`, rank by rank, so no stale tail is read. */
  shownPacked: Int32Array
  wantedPacked: Int32Array
  visible: number
  selectedTriangles: number
  displayedTriangles: number
  frustumRejected: number
  /** Hierarchy nodes popped by the cut, what selection actually tested. */
  nodesTested: number
  lodLevel: number
  complete: boolean
  /** Triangles of the root-cover clusters in view the rule would draw but that are not resident:
   *  nothing coarser stands in for them, so their surface is a hole (`./take.fixture.ts`). Zero
   *  when the cut holds no residency. */
  uncoveredTriangles: number
  pixelError: number
}
