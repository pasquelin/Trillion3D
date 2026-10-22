import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import type { BounceCascades } from '../../../../sdk-core/src/bounce/cascades.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import type { GpuLightTiles } from '../tiles/tiles.ts'
import type { createProbeStorage } from './probes/probeStorage.ts'

/**
 * The world grid's light lists, which the probe and reflection hits walk
 * (`lightCellWgsl.ts`): the light grid's world pass over the lattice laid on the scene's extent
 * (`lightLattice`, `createGpuLightTiles`), in the buffer every reader of a list binds, encoded on a frame where the
 * lights, that lattice or the buffer changed — a still scene lists nothing again. Their start goes to
 * the levels' uniform (`setLightLists`); without a grid, none, and every point walks every light.
 */
export function worldLightLists(
  tiles: () => GpuLightTiles | undefined,
  lights: () => GPUBuffer,
  uniform: ReturnType<typeof createProbeStorage>['uniform'],
) {
  /** What the lists were listed for — the lattice's cell and corner, the lights, the grid's buffer
   *  — and what this encode asks: compared in place, nothing allocated a frame. */
  const listedFor = new Float64Array(6),
    asked = new Float64Array(6)
  let listed = false
  return {
    /** A light changed: the lists are listed again at the next encode. */
    stale() {
      listed = false
    },
    /** The lists of `cascades`' lattice over `count` lights, encoded when stale: the buffer that
     *  holds them, or none. */
    encode(encoder: GPUCommandEncoder, cascades: BounceCascades, count: number, frame: number) {
      const grid = tiles()
      if (!grid?.ensureWorld(BOUNCE_SETTINGS.lightGridSide, lights(), count)) {
        uniform.setLightLists(undefined)
        return undefined
      }
      const { lattice } = cascades
      asked[0] = lattice.spacing
      asked[1] = lattice.corner[0]
      asked[2] = lattice.corner[1]
      asked[3] = lattice.corner[2]
      asked[4] = count
      asked[5] = grid.revision
      if (!listed || !sameValues(listedFor, asked)) {
        grid.updateWorld(lattice.corner, lattice.spacing)
        listed = grid.encodeWorld(encoder, frame)
        listedFor.set(asked)
      }
      uniform.setLightLists(listed ? grid.worldStart : undefined)
      return grid.buffer
    },
  }
}
