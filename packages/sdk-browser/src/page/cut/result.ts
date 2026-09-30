/** Cut result, filled in place: the caller supplies the object, the image allocates none. */
export interface SelectionResult<T> {
  shown: T[];
  wanted: T[];
  /** The instances as packed catalogue ranks, parallel to `shown` and `wanted` rank by rank: the
   *  identity the engines' consumers route by (a packed rank is the engine's per-placement page),
   *  resolved back to a record through the catalogue (`recordOf(packed)`). Reused `Int32Array`s,
   *  preallocated to the cut's capacity (`fitPacked`); their live ranks are those of `shown` and
   *  `wanted`, rank by rank, so no stale tail is read. */
  shownPacked: Int32Array;
  wantedPacked: Int32Array;
  visible: number;
  selectedTriangles: number;
  displayedTriangles: number;
  frustumRejected: number;
  /** Hierarchy nodes popped by the cut, what selection actually tested. */
  nodesTested: number;
  lodLevel: number;
  complete: boolean;
  /** Triangles of the root-cover clusters in view the rule would draw but that are not resident:
   *  nothing coarser stands in for them, so their surface is a hole (`./take.ts`). Zero when the
   *  cut holds no residency. */
  uncoveredTriangles: number;
  pixelError: number;
}

/** An empty cut result, to set once per hot caller then reuse from image to image:
 *  `selectVisiblePages` rewrites every field, only the object's identity matters. */
export function createSelectionResult<T>(): SelectionResult<T> {
  return {
    shown: [],
    wanted: [],
    shownPacked: new Int32Array(0),
    wantedPacked: new Int32Array(0),
    visible: 0,
    selectedTriangles: 0,
    displayedTriangles: 0,
    frustumRejected: 0,
    nodesTested: 0,
    lodLevel: 0,
    complete: true,
    uncoveredTriangles: 0,
    pixelError: 0,
  };
}
