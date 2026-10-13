import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_WGSL } from '../../placement/gpuComposeWgsl.ts'
import { treeLeavesWgsl } from '../../placement/treeLeavesWgsl.ts'
import { ROOT_BOXES_WGSL } from '../../placement/rootBoxesWgsl.ts'
import { DERIVE_ROWS_WGSL } from '../../placement/rowWordsWgsl.ts'
import { ENTRY_CORNERS_WGSL } from '../../webgpu/transparent/entryCornersWgsl.ts'
import { treeRefitWgsl } from '../dag/treeRefitWgsl.ts'
import { rayQueryWgsl } from '../../webgpu/rays/rayQueryWgsl.ts'
import { DEFORM_INDEX_SHADER } from '../../webgpu/rays/deformIndexWgsl.ts'

/** The texts of the passes beside the cut that read its tables — the GPU composition, the root
 *  boxes and rows passes, the tree's leaves and its refit, the ray query —: the tables whole, and
 *  as a device that splits them lays them out (`nodeTableWgsl.ts`, `nodeTableBlock`; the frames'
 *  ranges). */
export const COMPOSE_SHADERS = {
  TREE_LEAVES: treeLeavesWgsl(),
  TREE_LEAVES_SPLIT: treeLeavesWgsl({ per: 4096, parts: 2 }),
  COMPOSE_ROOTS_WGSL,
  COMPOSE_WORLDS_WGSL,
  ROOT_BOXES_WGSL,
  DERIVE_ROWS_WGSL,
  ENTRY_CORNERS_WGSL,
  TREE_REFIT: treeRefitWgsl(),
  TREE_REFIT_SPLIT: treeRefitWgsl({ frames: [0, 1024] }),
  DEFORM_INDEX_SHADER,
  RAY_QUERY: rayQueryWgsl({ nodes: { per: Infinity, parts: 1 } }),
  RAY_QUERY_SPLIT: rayQueryWgsl({ nodes: { per: 4096, parts: 3 } }),
}
