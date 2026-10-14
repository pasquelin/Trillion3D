import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_WGSL } from '../../placement/gpuComposeWgsl.ts'
import { TREE_LEAVES_WGSL } from '../../placement/treeLeavesWgsl.ts'
import { ROOT_BOXES_WGSL } from '../../placement/rootBoxesWgsl.ts'
import { DERIVE_ROWS_WGSL } from '../../placement/rowWordsWgsl.ts'
import { ENTRY_CORNERS_WGSL } from '../../webgpu/transparent/entryCornersWgsl.ts'
import { TREE_REFIT_WGSL } from '../dag/treeRefitWgsl.ts'

/** The texts of the GPU composition, of the root boxes and rows passes, of the tree's leaves and of
 *  its refit: one each, every table a record table whatever the world. */
export const COMPOSE_SHADERS = {
  TREE_LEAVES_WGSL,
  COMPOSE_ROOTS_WGSL,
  COMPOSE_WORLDS_WGSL,
  ROOT_BOXES_WGSL,
  DERIVE_ROWS_WGSL,
  ENTRY_CORNERS_WGSL,
  TREE_REFIT_WGSL,
}
