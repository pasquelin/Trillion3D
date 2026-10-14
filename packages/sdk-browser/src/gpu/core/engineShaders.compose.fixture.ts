import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_WGSL } from '../../placement/gpuComposeWgsl.ts'
import { COMPOSE_MOTION_WGSL } from '../../placement/composedMotionWgsl.ts'
import { TREE_LEAVES_WGSL } from '../../placement/treeLeavesWgsl.ts'
import { ROOT_BOXES_WGSL } from '../../placement/rootBoxesWgsl.ts'
import { DERIVE_ROWS_WGSL } from '../../placement/rowWordsWgsl.ts'
import { ENTRY_CORNERS_WGSL } from '../../webgpu/transparent/entryCornersWgsl.ts'
import { TREE_REFIT_WGSL } from '../dag/treeRefitWgsl.ts'
import { RAY_QUERY_WGSL } from '../../webgpu/rays/rayQueryWgsl.ts'
import { DEFORM_INDEX_SHADER } from '../../webgpu/rays/deformIndexWgsl.ts'

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
