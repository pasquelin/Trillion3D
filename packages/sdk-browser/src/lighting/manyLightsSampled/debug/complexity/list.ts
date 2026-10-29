/**
 * THE LIST THE LIGHT COMPLEXITY VIEW WRITES (pure, no GPU): the rows of text, where they stand, which light the cursor selects, and the dump to the console. A row is the light's share of the
 * sum of the weights (four decimals, in eight columns), whether it was seen (two decimals, six columns), its kind (seven columns) and its name.
 */
import { textSegments } from '../../../../hair/debugFont.ts'
import { TEXT_LINE } from '../../../../diagnostic/textOverlay.ts'
import {
  COMPLEXITY_KIND,
  COMPLEXITY_KIND_NAMES,
  type ComplexityLight,
  type ComplexityList,
} from './entries.ts'

/** The pixel size of a text cell, and so of a character (`textSegments`: four cells across) and of a row. */
const CELL = 2
const CHARACTER_WIDTH = textSegments('0', 0, 0, CELL, () => {})[0]
/** Where the list starts, as a share of the display, and the rows above the lights (the cell, the count, the column names). */
const LIST_START = [0.05, 0.05] as const
const HEADER_ROWS = 3
/** The columns before a light's name: the share, the visibility and the kind. */
const SHARE_COLUMNS = 8
const SEEN_COLUMNS = 6
const KIND_COLUMNS = 7
/** The radius, in metres, of the sphere round a light the cursor's ray selects it by, and of its symbol. */
export const LIGHT_SYMBOL_SIZE = 0.1

/** The share of the sum of the weights a light has. */
const shareOf = (light: ComplexityLight, sum: number) => light.weight / Math.max(sum, 1e-8)

/** The columns of a row before the light's name. */
export function rowPrefix(light: ComplexityLight, sum: number) {
  return `${shareOf(light, sum).toFixed(4).padStart(SHARE_COLUMNS)}${light.seen.toFixed(2).padStart(SEEN_COLUMNS)}${(COMPLEXITY_KIND_NAMES[light.kind] ?? 'Error').padEnd(KIND_COLUMNS)}`
}

/** The text of the three lines above the lights: the pixel, the count of lights and the names of the columns. */
export const headerRows = (cursor: readonly [number, number], count: number, frozen: boolean) => [
  frozen ? 'Displaying frozen data...' : `ScreenCoord: ${cursor[0]} ${cursor[1]}`,
  `NumLights: ${count}`,
  'Ratio | Vis | Type | Name',
]

/** The pixel where the list starts on a display of `size`. */
export const listOrigin = (size: readonly [number, number]) =>
  [Math.round(size[0] * LIST_START[0]), Math.round(size[1] * LIST_START[1])] as const

/** The rectangle (x0, y0, x1, y1), in display pixels, of the row of light `index` whose name is `name`. */
function rowRect(
  size: readonly [number, number],
  index: number,
  prefix: string,
  name: string,
): readonly [number, number, number, number] {
  const [x, y] = listOrigin(size)
  const top = y + (HEADER_ROWS + index) * TEXT_LINE
  return [x, top, x + (prefix.length + name.length) * CHARACTER_WIDTH, top + TEXT_LINE]
}

/** The distances along a ray from `origin` along `direction` (unit) at which it enters and leaves the sphere of `centre` and `radius`, none where it misses. */
function raySphere(
  origin: ArrayLike<number>,
  direction: ArrayLike<number>,
  centre: ArrayLike<number>,
  radius: number,
): readonly [number, number] | undefined {
  const o = [origin[0]! - centre[0]!, origin[1]! - centre[1]!, origin[2]! - centre[2]!]
  const b = o[0]! * direction[0]! + o[1]! * direction[1]! + o[2]! * direction[2]!
  const c = o[0]! * o[0]! + o[1]! * o[1]! + o[2]! * o[2]! - radius * radius
  const discriminant = b * b - c
  if (discriminant < 0) return undefined
  const root = Math.sqrt(discriminant)
  return [-b - root, -b + root]
}

/**
 * The light the cursor selects among the first `shown` of `list`: the nearest of those whose row of text the cursor (display pixels) lies in (distance 0) and those, not directional, whose sphere
 * the cursor's ray (`origin`, `direction` unit) crosses ahead; the first of equals; -1 for none. `names` the light of each rank.
 */
export function selectedLight(
  list: ComplexityList,
  shown: number,
  names: (rank: number) => string,
  size: readonly [number, number],
  cursor: readonly [number, number],
  origin: ArrayLike<number>,
  direction: ArrayLike<number>,
) {
  let nearest = Infinity
  let chosen = -1
  for (let index = 0; index < shown; index++) {
    const light = list.lights[index]!
    let distance = Infinity
    const [x0, y0, x1, y1] = rowRect(size, index, rowPrefix(light, list.sum), names(light.rank))
    if (cursor[0] > x0 && cursor[0] < x1 && cursor[1] > y0 && cursor[1] < y1) distance = 0
    else if (light.kind !== COMPLEXITY_KIND.directional) {
      const hit = raySphere(origin, direction, light.place, LIGHT_SYMBOL_SIZE)
      if (hit && hit[0] > 0 && hit[1] > 0) distance = hit[0]
    }
    if (distance < nearest) {
      nearest = distance
      chosen = index
    }
  }
  return chosen
}

const dumpPlace = (light: ComplexityLight) => `(${light.place.map((v) => v.toFixed(3)).join(', ')})`

/** The text the dump writes to the console: the lights in their order, a column each for the name, the share and the weight, the visibility, the kind and the place or direction. */
export function dumpText(list: ComplexityList, names: (rank: number) => string) {
  const width = Math.max(9, ...list.lights.map((light) => names(light.rank).length))
  const rows = list.lights.map((light) => {
    const share = `${shareOf(light, list.sum).toFixed(3)} (${light.weight.toFixed(3)})`
    return `${names(light.rank).padStart(width)} ,${share.padStart(21)} , ${light.seen.toFixed(3).padStart(10)} , ${(COMPLEXITY_KIND_NAMES[light.kind] ?? 'Unknown').padStart(9)} , ${dumpPlace(light)}`
  })
  return [
    'Dumping the sampled lights light complexity list...',
    `NumLights: ${list.lights.length}`,
    `${'LightName'.padStart(width)} | WeightRatio (Weight) | Visibility | LightType | WorldPosition or Direction`,
    ...rows,
  ].join('\n')
}
