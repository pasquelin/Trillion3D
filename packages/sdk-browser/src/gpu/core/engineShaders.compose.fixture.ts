import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_WGSL } from '../../placement/gpuComposeWgsl.ts'
import { treeLeavesWgsl } from '../../placement/treeLeavesWgsl.ts'
import { ROOT_BOXES_WGSL } from '../../placement/rootBoxesWgsl.ts'
import { DERIVE_ROWS_WGSL } from '../../placement/rowWordsWgsl.ts'
import { ENTRY_CORNERS_WGSL } from '../../webgpu/transparent/entryCornersWgsl.ts'
import { TREE_REFIT_WGSL } from '../dag/treeRefitWgsl.ts'

/** The texts of the GPU composition, of the root boxes and rows passes, of the tree's leaves and of
 *  its refit: the tables whole, and as a device that splits them lays them out (`nodeTableWgsl.ts`,
 *  `nodeTableBlock`). */
export const COMPOSE_SHADERS = {
  TREE_LEAVES: treeLeavesWgsl(),
  TREE_LEAVES_SPLIT: treeLeavesWgsl({ per: 4096, parts: 2 }),
  COMPOSE_ROOTS_WGSL,
  COMPOSE_WORLDS_WGSL,
  ROOT_BOXES_WGSL,
  DERIVE_ROWS_WGSL,
  ENTRY_CORNERS_WGSL,
  TREE_REFIT_WGSL,
}
