/** Packed-node ranks, in the order `struct CullNode` of the shader declares them. `packNodes.ts`
 *  writes them; the shader, the oracle (`oracle/math.fixture.ts`) and frontier counting reread
 *  them. They are declared only here: a moved field cannot leave a reader behind. */
export const NODE_MIN = 0,
  NODE_FIRST_CHILD = 3,
  NODE_MAX = 4,
  /** Replacement error ceiling of the subtree, -1 when the manifest does not carry one. */
  NODE_CEIL = 7,
  NODE_SPHERE = 8,
  NODE_WORLD = 12,
  NODE_FIRST_PAGE = 13,
  NODE_PAGE_COUNT = 14,
  NODE_CHILD_COUNT = 15,
  NODE_FLOOR_SPHERE = 16,
  NODE_FLOOR = 20,
  /** Clusters of the subtree whose finer group is not resident (`../../page/cut/readiness.ts`). */
  NODE_OPEN = 21;
/** The two pad words that bring the node to ninety-six bytes, vec4-aligned. */
export const NODE_PAD = 22;
