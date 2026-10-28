import { createViewHidden } from '../frame/render/viewHidden.ts'
import { createDeformationFrame } from './frame.ts'
import { createWebgpuLightState } from '../frame/backend/state/lights.ts'
import type { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import type { ClusterRoot, PageRec } from '../geometry/selection/types.ts'
import { createChangedRuns } from '../geometry/residency/ranges.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { NO_RASTERS } from '../materials/graph/graphRasters.ts'
import { createRootOffsets } from '../frame/render/rootOffsets.ts'

/**
 * The pages runtime `updateWebgpuDeformation` reads, around one deformation `frame`: placements
 * `selectionRoots`, no bank track, a light state that records every world box it is told changed
 * (`changed`, min then max) and the placements whose records were marked to be written again
 * (`marked`).
 */
export function deformationRuntime(
  world: Matrix4,
  frame: ReturnType<typeof createDeformationFrame>,
  selectionRoots: object[],
  extra: { vis?: object; run?: object; materialTable?: object } = {},
) {
  const lights = createWebgpuLightState()
  lights.mobility.ensure(1, () => world.elements)
  const changed: number[][] = [],
    marked: number[] = []
  Object.assign(lights.changes, {
    worldChanged: (min: ArrayLike<number>, max: ArrayLike<number>) => {
      changed.push([...Array.from(min), ...Array.from(max)])
    },
  })
  const rt = {
    vis: {
      deformation: {
        ...{ any: true, frame, base: 0, entryOf: (rank: number) => rank },
        tracks: { count: 0, plays: () => false },
        update: () => frame.update(),
      },
      concatPos: {},
      rasters: NO_RASTERS,
      rootOffsets: createRootOffsets(),
      materialTable: { offsetEpoch: 0, ...extra.materialTable },
      ...extra.vis,
    },
    gpu: { device: { queue: { writeBuffer() {} } } },
    lights,
    layout: {
      selectionRoots,
      clusters: { placementInfo: { mark: (rank: number) => marked.push(rank) } },
      rootIndex: { revision: 0 },
      // What the views of a root's owner see of it (`followOffsets` writes it): the session's own list.
      viewHidden: createViewHidden(),
    },
    run: {
      movedWorlds: createChangedRuns(),
      gate: { cam: { eye: [0, 0, 0] }, revisions: { scene: 1 } },
      ...extra.run,
    },
    setup: {},
    blendState: { blendGpu: [], blendIndex: { revision: 0 } },
  } as unknown as WebgpuPagesRuntime
  return { rt, changed, marked }
}

/** A placement at `world` of the one page `rec`, whose boxes are the cube of half-side one, the
 *  record packed at rank 0 of it. */
export function unitRoot(world: Matrix4, rec: PageRec) {
  const root: Omit<ClusterRoot<PageRec>, 'world'> & { world: Matrix4 } = {
    world,
    pages: [rec],
    reach: 0,
    packedBase: 0,
    localBox: new Float64Array([-1, -1, -1, 1, 1, 1]),
    worldBox: new Float64Array([-1, -1, -1, 1, 1, 1]),
  }
  return root
}
