import { COMPOSE_ROOTS_WGSL, COMPOSE_WORLDS_WGSL } from '../../placement/gpuComposeWgsl.ts'
import { composeMembersWgsl } from '../../placement/gpuComposeMembersWgsl.ts'
import { DERIVE_ROWS_WGSL } from '../../placement/rowWordsWgsl.ts'
import { ENTRY_CORNERS_WGSL } from '../../webgpu/transparent/entryCornersWgsl.ts'
import { treeRefitWgsl } from '../dag/treeRefitWgsl.ts'

/** The texts of the GPU composition, of the rows pass and of the tree refit: the tables whole, and
 *  as a device that splits them lays them out (`treeRefitWgsl.ts`, `nodeTableBlock`). */
export const COMPOSE_SHADERS = {
  COMPOSE_MEMBERS: composeMembersWgsl(),
  COMPOSE_MEMBERS_SPLIT: composeMembersWgsl({ per: 4096, parts: 2 }),
  COMPOSE_ROOTS_WGSL,
  COMPOSE_WORLDS_WGSL,
  DERIVE_ROWS_WGSL,
  ENTRY_CORNERS_WGSL,
  TREE_REFIT: treeRefitWgsl(),
  TREE_REFIT_SPLIT: treeRefitWgsl({
    nodes: { per: 4096, parts: 2 },
    cold: { per: 4096, parts: 2 },
    frames: [0, 1024],
  }),
}
