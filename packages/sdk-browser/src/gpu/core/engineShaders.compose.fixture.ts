import {
  composeMembersWgsl,
  COMPOSE_ROOTS_WGSL,
  COMPOSE_ROWS_WGSL,
} from '../../placement/gpuComposeWgsl.ts'
import { treeRefitWgsl } from '../dag/treeRefitWgsl.ts'

/** The texts of the GPU composition and of the tree refit: the tables whole, and as a device that
 *  splits them lays them out (`nodeTableWgsl.ts`, `nodeTableBlock`; the frames' ranges). */
export const COMPOSE_SHADERS = {
  COMPOSE_MEMBERS: composeMembersWgsl(),
  COMPOSE_MEMBERS_SPLIT: composeMembersWgsl({ per: 4096, parts: 2 }),
  COMPOSE_ROOTS_WGSL,
  COMPOSE_ROWS_WGSL,
  TREE_REFIT: treeRefitWgsl(),
  TREE_REFIT_SPLIT: treeRefitWgsl({ frames: [0, 1024] }),
}
