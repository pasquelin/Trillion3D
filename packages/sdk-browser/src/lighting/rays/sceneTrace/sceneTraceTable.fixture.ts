// The fixtures of the scene trace's resources tests: a ray tracing file, a cut packing a world DAG, the table's words and the culling of the defaults.
import type { RayTracing } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { words } from '../../../../../../tests/kit/fakeDevice/fakeBuffers.ts'
import type { TracedWorld } from './sceneTraceResources.ts'
import { SCENE_TRACE_CELL_DRAWN, SCENE_TRACE_WORLD_BIT } from './sceneTraceWgsl.ts'

/** The word of a placement of the world DAG at instance 0 in the table. */
export const WORLD = SCENE_TRACE_WORLD_BIT

/** The culling of the reference’s defaults, a view looking along -z. */
export const CULLING = {
  mode: 3,
  radius: 300,
  angle: 1,
  useDistanceToBox: true,
  useMinDrawDistance: true,
  direction: [0, 0, -1],
  viewDistanceScale: 1,
  instanceDrawDistance: true,
} as const

export const fileOf = (): RayTracing => ({
  records: new Uint32Array([7, 8, 9, 10]),
  nodes: new Uint32Array(8).fill(1),
  triangles: new Uint32Array(12).fill(2),
  corners: new Uint32Array(0),
  byPrimitive: new Map([[3, new Map([[5, 2]])]]),
  actorCells: 0,
})

/** A cut packing a world DAG of `cells` cells and `instances` instances, the cell `draws(instance, cell)` says drawn. */
export const worldOf = (
  cells: number,
  instances: number,
  draws: (instance: number, cell: number) => boolean,
) =>
  ({
    world: { draws, drawRevision: 0 },
    cellStates: { cells, instances },
  }) as unknown as TracedWorld

export const worldFileOf = (): RayTracing => ({ ...fileOf(), world: 1, actorCells: 3 })

/** The words of the table of `trace`. */
export const tableOf = (trace: { readonly table: GPUBuffer }) =>
  Array.from(words((trace.table as unknown as { data: Uint8Array }).data))

/** A cell's word: drawn, a hit on it told by the rank `object` (none, by default: the rank plus one is zero). */
export const drawn = (object?: number) =>
  (SCENE_TRACE_CELL_DRAWN | (object === undefined ? 0 : object + 1)) >>> 0
