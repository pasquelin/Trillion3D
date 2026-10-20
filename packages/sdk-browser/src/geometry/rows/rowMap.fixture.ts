import { mixWord } from '../../../../math/src/scalar/integers.ts'
import { ROW_MAP_HEAD } from './rowMapWgsl.ts'

/** The CPU twin of the shader's `rowOfPage` (`rowMapWgsl.ts`), word for word, on the map's words as
 *  the GPU holds them: the row `page` holds, -1 for none. */
export function rowOfPageIn(map: Uint32Array, page: number) {
  const slots = map[0]
  if (!slots) return -1
  const mask = slots - 1
  let at = mixWord(page) & mask
  for (let k = 0; k < slots; k++) {
    const key = map[ROW_MAP_HEAD + at]
    if (key === page) return map[ROW_MAP_HEAD + slots + at] - 1
    if (key === 0xffffffff) return -1
    at = (at + 1) & mask
  }
  return -1
}
