/**
 * THE SHAPE OF A DESCENT: what the one level-by-level descent (`levelWgsl.ts`, its lists
 * `listsWgsl.ts`, the placement tree's share `placementTreeWgsl.ts`) is written for, as the
 * reference's persistent hierarchy culling runs over every view of a pass, each candidate node
 * carrying the view that tests it.
 *
 * The camera's cut is one view (`CAMERA_DESCENT`): an entry is a node and its placement, the view
 * the cut's uniform block. A descent over a list of views (`views`) carries the view of each entry
 * beside them — a queue entry, an item held for the post pass —: the level reads it into
 * `descentView` with the entry, and every append writes the running `descentView` with its own
 * entries, so the tests a level runs read the view of the entry they test. Queue 0 holds a view's
 * roots after another's (`putEntry`, `rootSlots` a view).
 *
 * A views descent lists a page once, whichever views keep its leaf (`candAppend`): the clusters
 * its views judge after it are each view's own. The nodes a view's previous pyramid alone hides are
 * held for its post pass with their view (`postNode`), which the program says to judge in the
 * running pass (`heldHere`, `postPassWgsl.ts`) and tests by the view's own sight (`boxSight`).
 *
 * The hooks are the texts a views descent replaces: what is built once for a node before its tests,
 * the test of a node's subtree at the threshold, the test of a leaf too coarse, the test of a cell of
 * the placement tree, a leaf's request priority, and the resets of the lists the camera's cut alone
 * holds. The camera's texts are the program's as it was written: its module
 * does not change by a word.
 */
export interface DescentShape {
  /** Whether an entry carries the index of its view (`descentView`). */
  readonly views: boolean
  /** The statement run once for each node a level tests (a root, a child, a held item of the post
   *  pass), from `node` (`CullNode`) and its placement `w`, before the hooks below read it: where a
   *  views descent builds what they share, the entry's view of the node's box. Empty for the camera's. */
  readonly begin: string
  /** The expression a node's subtree is needed by at the threshold, from `node` (`CullNode`), its
   *  placement `w` and, in the camera's, `e` (`viewWorld(w)`). */
  readonly subtreeNeeded: string
  /** Whether the program holds the camera's subtree test (`subtreeNeeded`, `error.ts`). */
  readonly cameraSubtree: boolean
  /** How a leaf is judged too coarse and dropped, the floor of its error seen past the threshold at
   *  its ball's largest edge scale (`floorWgsl.ts`): by the camera's rule (`camera`, `floorPrunes`), by
   *  the program's own `viewFloor(node,w)` (`views`), or never (`none`). */
  readonly floor: 'camera' | 'views' | 'none'
  /** The test a cell of the placement tree is out of the view by, from its render-frame box. */
  readonly cellOutside: string
  /** The expression of a kept leaf's request priority word, from `node` and its placement `w`. */
  readonly priority: string
  /** What the frame's resets add for the camera's lists: its visible clusters (`visibleWgsl.ts`). */
  readonly resets: string
}

/** The camera's cut: one view, its block of the uniform buffer (`viewsWgsl.ts`). */
export const CAMERA_DESCENT: DescentShape = {
  views: false,
  begin: '',
  subtreeNeeded: 'subtreeNeeded(node,sphereEdges(node.sphere,e).x)',
  cameraSubtree: true,
  floor: 'camera',
  cellOutside: 'outsideView',
  priority: 'leafPriority(node,viewWorld(w))',
  resets: '\n resetVisible();',
}

/** The test of a leaf too coarse, by the shape's `floor`: a condition of `node`, `w`, `c` and `e`. */
export const floorTest = (shape: DescentShape) =>
  ({
    camera: 'floorPrunes(openOf(w,c,node.open),node,e)',
    views: 'viewFloor(node,w)',
    none: 'false',
  })[shape.floor]
/** The shape's `begin` as a statement line of a level's text: none for a shape with none. */
export const beginLine = (shape: DescentShape) => (shape.begin ? ` ${shape.begin}\n` : '')

/** Words of a descent entry in the descent array: the entry, its placement, and its view where the
 *  descent carries one. */
export const entryWords = (shape: DescentShape) => (shape.views ? 3 : 2)
/** Words of an item the previous pyramid hid (`postNode`): the first item, its placement, the mask
 *  of the items held from it, and its view where the descent carries one. */
export const postWords = (shape: DescentShape) => (shape.views ? 4 : 3)
