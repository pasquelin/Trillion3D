import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/** How the view is cut into the tiles the local fog volumes are culled by: the tile's side in pixels, the
 *  tiles across the view and down it, the words a tile's list takes, and the words of the lists of all
 *  the tiles and of the flags that follow them (`localFogTiling`). */
export interface LocalFogTiling {
  size: number
  across: number
  down: number
  stride: number
  words: number
}

/** The words a tile's list takes for up to `maxCount` volumes: its count, then their numbers, four to a
 *  word — a number is a byte, which the count of volumes a view draws is held to (`LOCAL_FOG_MOST_VOLUMES`). */
const tileStride = (maxCount: number) => 1 + ceilDiv(maxCount, 4)

/**
 * The tiling of a view of `width` × `height` pixels by tiles of `size` pixels a side, the last tile of a
 * row or a column reaching past the view where the side does not divide it; none for a view with no
 * pixel. The words are the lists of every tile, then one flag a volume the culling pass keeps for the
 * depth pyramid's verdicts (`localCullWgsl.ts`): the buffer is made for the grid, whatever its size.
 * Written into `out` where one is given (an image allocates none), else into a new object.
 */
export function localFogTiling(
  width: number,
  height: number,
  size: number,
  maxCount: number,
  out: LocalFogTiling = { size, across: 0, down: 0, stride: 0, words: 0 },
): LocalFogTiling | undefined {
  if (!(width >= 1 && height >= 1)) return undefined
  out.size = size
  out.across = ceilDiv(width, size)
  out.down = ceilDiv(height, size)
  out.stride = tileStride(maxCount)
  out.words = out.across * out.down * out.stride + maxCount
  return out
}
