import type { BounceCascades } from '../../../sdk-core/src/bounce/cascades.ts'
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'
import type { GpuLightTiles } from '../lighting/tiles/tiles.ts'
import type { createProbeStorage } from './probeStorage.ts'

/**
 * The world grid's light lists, which the probe and reflection hits walk
 * (`lightCellWgsl.ts`): the light grid's world pass over the last cascade level's lattice
 * (`createGpuLightTiles`), in the buffer every reader of a list binds, encoded on a frame where the
 * lights, that lattice or the buffer changed — a still scene lists nothing again. Their start goes to
 * the cascades' uniform (`setLightLists`); without a grid, none, and every point walks every light.
 */
export function worldLightLists(
  tiles: () => GpuLightTiles | undefined,
  lights: () => GPUBuffer,
  uniform: ReturnType<typeof createProbeStorage>['uniform'],
) {
  const corner = new Float32Array(3)
  /** What the lists were listed for — the last level's spacing and base, the lights, the grid's buffer
   *  — and what this encode asks: compared in place, nothing allocated a frame. */
  const listedFor = new Float64Array(6),
    asked = new Float64Array(6)
  let listed = false
  return {
    /** A light changed: the lists are listed again at the next encode. */
    stale() {
      listed = false
    },
    /** The lists of `cascades`' last level over `count` lights, encoded when stale: the buffer that
     *  holds them, or none. */
    encode(encoder: GPUCommandEncoder, cascades: BounceCascades, count: number, frame: number) {
      const grid = tiles()
      if (!grid?.ensureWorld(cascades.size, lights(), count)) {
        uniform.setLightLists(undefined)
        return undefined
      }
      const level = cascades.levels[cascades.levels.length - 1]
      asked[0] = level.spacing
      asked[1] = level.base[0]
      asked[2] = level.base[1]
      asked[3] = level.base[2]
      asked[4] = count
      asked[5] = grid.revision
      if (!listed || !sameValues(listedFor, asked)) {
        for (let axis = 0; axis < 3; axis++) corner[axis] = level.base[axis] * level.spacing
        grid.updateWorld(corner, level.spacing)
        listed = grid.encodeWorld(encoder, frame)
        listedFor.set(asked)
      }
      uniform.setLightLists(listed ? grid.worldStart : undefined)
      return grid.buffer
    },
  }
}
