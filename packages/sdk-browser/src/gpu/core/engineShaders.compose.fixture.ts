import {
  composeMembersWgsl,
  COMPOSE_ROOTS_WGSL,
  COMPOSE_ROWS_WGSL,
} from '../../placement/gpuComposeWgsl.ts'
import { treeRefitWgsl } from '../dag/treeRefitWgsl.ts'
import { rayQueryWgsl } from '../../webgpu/rays/rayQueryWgsl.ts'
import { ROW_HASH_SHADER } from '../../webgpu/rays/rowHashWgsl.ts'

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
  ROW_HASH_SHADER,
  RAY_QUERY: rayQueryWgsl({
    nodes: { per: Infinity, parts: 1 },
    cold: { per: Infinity, parts: 1 },
    ranges: [{ first: 0, count: 64 }],
  }),
  RAY_QUERY_SPLIT: rayQueryWgsl({
    nodes: { per: 4096, parts: 2 },
    cold: { per: 4096, parts: 2 },
    ranges: [
      { first: 0, count: 1024 },
      { first: 1024, count: 512 },
    ],
  }),
}
