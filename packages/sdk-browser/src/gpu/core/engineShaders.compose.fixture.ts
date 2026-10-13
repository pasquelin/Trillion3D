import {
  composeMembersWgsl,
  COMPOSE_ROOTS_WGSL,
  COMPOSE_ROWS_WGSL,
} from '../../placement/gpuComposeWgsl.ts'
import { treeRefitWgsl } from '../dag/treeRefitWgsl.ts'
import { rayQueryWgsl } from '../../webgpu/rays/rayQueryWgsl.ts'
import { DEFORM_INDEX_SHADER } from '../../webgpu/rays/deformIndexWgsl.ts'

/** The texts of the passes beside the cut that read its tables — the GPU composition, the tree
 *  refit and the ray query —: the tables whole, and as a device that splits them lays them out
 *  (`../dag/cutTablesWgsl.ts`, `nodeTableBlock`). */
export const COMPOSE_SHADERS = {
  COMPOSE_MEMBERS: composeMembersWgsl(),
  COMPOSE_MEMBERS_SPLIT: composeMembersWgsl({ per: 4096, parts: 2 }),
  COMPOSE_ROOTS_WGSL,
  COMPOSE_ROWS_WGSL,
  TREE_REFIT: treeRefitWgsl(),
  TREE_REFIT_SPLIT: treeRefitWgsl({
    nodes: { per: 4096, parts: 2 },
    cold: { per: 4096, parts: 2 },
    frames: [0, 1024],
  }),
  DEFORM_INDEX_SHADER,
  RAY_QUERY: rayQueryWgsl({ nodes: { per: Infinity, parts: 1 } }),
  RAY_QUERY_SPLIT: rayQueryWgsl({ nodes: { per: 4096, parts: 3 } }),
}
