import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { VIEW_BLOCK_WORDS } from '../viewLayout.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/**
 * The cut's one view: its block of the uniform buffer (`../viewLayout.ts`), read by every kernel as
 * `cutView`, and the flag a descent entry carries in its top bit.
 *
 * A queue entry names an item ACCEPTED at the level before — a node of a placement, a cell of the
 * placement tree —, whose children the level tests (`levelWgsl.ts`), or, flagged `ENTRY_TEST`, an
 * item that still awaits its own test: a placement's root or a top cell, which queue 0 opens with
 * (`placementTreeWgsl.ts`). A member a kept group of the tree deposits is tested by the level that
 * reads it, as its own range of entries says (`nodeCount + k`).
 */
/** The top bit of a descent entry: the item awaits its own test. */
const ENTRY_TEST = 0x80000000

/** Bytes of the uniform buffer a cut binds: its block. */
export const DAG_UNIFORM_BYTES = VIEW_BLOCK_WORDS * 4

/** The block's `cullOff` word: the cut's culls the host turned off (`cutFrustumCulling`,
 *  `cutMinLodCulling`, `cutDrawDistanceCulling`, `cutClipPlaneCulling`,
 *  `../../../../../sdk-core/src/contracts/cutOptions.ts`) — the frustum's, the too coarse subtree's
 *  (`floorWgsl.ts`), the draw distance's (`drawDistanceWgsl.ts`) and the clip plane's
 *  (`clipPlaneWgsl.ts`) —, the draw distance's test at the sphere's edge
 *  (`cutDistanceCullToSphereEdge`), a test at the centre instead, and that no placement of the
 *  packing names a draw distance, which the packing says (`NO_DRAW_DISTANCES`, `../uniforms.ts`).
 *  The draw distance's switch (`CULL_DRAW_DISTANCE_OFF`) is that of the instances of an instanced
 *  mesh: an object of its own is always tested. None by default. */
export const CULL_FRUSTUM_OFF = 1,
  CULL_MIN_LOD_OFF = 2,
  CULL_DRAW_DISTANCE_OFF = 4,
  CULL_CLIP_PLANE_OFF = 8,
  CULL_SPHERE_EDGE_OFF = 16,
  CULL_NO_DRAW_DISTANCES = 32

export const DAG_VIEWS_WGSL = wgslBlock(
  'DAG_VIEWS_WGSL',
  [],
  `${wgslConsts({
    ENTRY_TEST,
    ENTRY_INDEX: ENTRY_TEST - 1,
  })}
${wgslConsts({
  CULL_FRUSTUM_OFF,
  CULL_MIN_LOD_OFF,
  CULL_DRAW_DISTANCE_OFF,
  CULL_CLIP_PLANE_OFF,
  CULL_SPHERE_EDGE_OFF,
  CULL_NO_DRAW_DISTANCES,
})}
/** Whether the host turned the cull \`bit\` off (\`cullOff\`). */
fn cullOff(bit:u32)->bool{return (cutView.cullOff&bit)!=0u;}
`,
)
