import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** Packed-node ranks, in the order `struct CullNode` of the shader declares them. `pack/packNodes.ts`
 *  writes them; the shader, the oracle (`oracle/math.fixture.ts`) and frontier counting reread
 *  them. They are declared only here: a moved field cannot leave a reader behind. */
export const NODE_MIN = 0,
  NODE_FIRST_CHILD = 3,
  NODE_MAX = 4,
  /** Replacement error ceiling of the subtree, -1 over a subtree holding a root. */
  NODE_CEIL = 7,
  /** The LOD ball both of the node's error tests project through. */
  NODE_SPHERE = 8,
  NODE_WORLD = 12,
  NODE_FIRST_PAGE = 13,
  NODE_PAGE_COUNT = 14,
  NODE_CHILD_COUNT = 15,
  /** The least own error of the subtree, from the manifest: a leaf's floor (`shader/floorWgsl.ts`). */
  NODE_FLOOR = 16,
  /** Clusters of the leaf whose finer group is not resident, zero for an inner node
   *  (`../cut/readiness.ts`). */
  NODE_OPEN = 17
/** What the node is: zero a placement's own node, else a node of the placement tree above them
 *  (`placement/placementTree.ts`, `TREE_CELL`, `TREE_GROUP`). */
export const NODE_KIND = 18
/** The pad word that brings the node to eighty bytes, vec4-aligned. */
export const NODE_PAD = 19
/** On a group of the placement tree — whose page words no page uses — the distances its placements
 *  are drawn at: the bits of two floats, the nearest and the farthest of them, both 0 when a
 *  placement is drawn at every distance (`tree/treeRefitWgsl.ts`, `shader/drawDistanceWgsl.ts`). */
export const TREE_DRAW_NEAR = NODE_FIRST_PAGE,
  TREE_DRAW_FAR = NODE_PAGE_COUNT

/** The low and high corners of node `n`'s box, `<name>Low(n)` and `<name>High(n)`, from the words
 *  `<name>Word(n,k)` of the table `name` names: the one corner reader of every walk, emitted by each
 *  table a node lies in (`nodeTable.ts`, `tree/treeTable.ts`). */
export const nodeCornersWgsl = (name: string) =>
  wgslBlock(
    `nodeCorners(${name})`,
    [],
    [NODE_MIN, NODE_MAX]
      .map(
        (k, i) =>
          `fn ${name}${i ? 'High' : 'Low'}(n:u32)->vec3f{return bitcast<vec3f>(vec3u(${name}Word(n,${k}u),${name}Word(n,${k + 1}u),${name}Word(n,${k + 2}u)));}`,
      )
      .join('\n'),
  )
