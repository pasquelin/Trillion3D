import { createDeformationFrame } from './frame.ts'
import { createWebgpuLightState } from '../frame/backend/state/lights.ts'
import type { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { createChangedRuns } from '../geometry/residency/ranges.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/**
 * The pages runtime `updateWebgpuDeformation` reads, around one deformation `frame`: placements
 * `selectionRoots` and their `rows`, no bank track, and a light state that records every world box
 * it is told changed (`changed`, min then max).
 */
export function deformationRuntime(
  world: Matrix4,
  frame: ReturnType<typeof createDeformationFrame>,
  selectionRoots: object[],
  rows: object,
) {
  const lights = createWebgpuLightState()
  lights.mobility.ensure(1, 2, () => world.elements)
  const changed: number[][] = []
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
    },
    gpu: { device: { queue: { writeBuffer() {} } } },
    lights,
    layout: { selectionRoots, rows, rootIndex: { revision: 0 } },
    run: { movedWorlds: createChangedRuns() },
    setup: {},
    blendState: { blendGpu: [], blendIndex: { revision: 0 } },
  } as unknown as WebgpuPagesRuntime
  return { rt, changed }
}
