import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_WGSL } from '../../placement/compose/gpuComposeWgsl.ts'
import { COMPOSE_MOTION_WGSL } from '../../placement/compose/composedMotionWgsl.ts'
import { TREE_LEAVES_WGSL } from '../../placement/tree/treeLeavesWgsl.ts'
import { ROOT_BOXES_WGSL } from '../../placement/roots/rootBoxesWgsl.ts'
import { DERIVE_ROWS_WGSL } from '../../placement/rows/rowWordsWgsl.ts'
import { ENTRY_CORNERS_WGSL } from '../../blend/transparent/entryCornersWgsl.ts'
import { TREE_REFIT_WGSL } from '../../geometry/dag/tree/treeRefitWgsl.ts'
import { RAY_QUERY_WGSL } from '../../lighting/rays/rayQueryWgsl.ts'
import { DEFORM_INDEX_SHADER } from '../../lighting/rays/deformIndexWgsl.ts'

/** The texts of the passes beside the cut that read its tables — the GPU composition, the root
 *  boxes and rows passes, the tree's leaves and its refit,
 *  the ray query —: one each, every table a record table whatever the world. */
export const COMPOSE_SHADERS = {
  TREE_LEAVES_WGSL,
  COMPOSE_ROOTS_WGSL,
  COMPOSE_WORLDS_WGSL,
  COMPOSE_MOTION_WGSL,
  ROOT_BOXES_WGSL,
  DERIVE_ROWS_WGSL,
  ENTRY_CORNERS_WGSL,
  TREE_REFIT_WGSL,
  DEFORM_INDEX_SHADER,
  RAY_QUERY_WGSL,
}
