import type { LightGridSettings } from '../../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'

/** The width, in texels, of the texture that holds the light grid: a word of the grid is the texel `word % LIGHT_GRID_WIDTH` of the row `word / LIGHT_GRID_WIDTH`. */
export const LIGHT_GRID_WIDTH = 4096

/** The words of the grid's header, which the lookup reads first (floats in their bits where they are bounds). */
export const LIGHT_GRID_HEADER = {
  /** The box that holds the reach of the local lights: its low corner (three words), then its high corner. */
  boundMin: 0,
  boundMax: 3,
  /** The cells a side, the axis (0 to 2 forces one, 3 picks cell by cell). */
  resolution: 6,
  axis: 7,
  /** The lights at infinity (the suns), whose ranks follow the header. */
  suns: 8,
  /** The word where the counts of the cells begin, and the word where their lists do. */
  countsAt: 9,
  dataAt: 10,
  /** The bytes of a rank in a list (1, 2 or 4), and the ranks a list can hold (its length rounded to a whole word). */
  bytes: 11,
  stride: 12,
  /** 1 where the grid is not kept (a budget or a device limit refused it): every light is looped over. */
  all: 13,
} as const
/** The words of the header. */
export const LIGHT_GRID_HEADER_WORDS = 14

/** The count a cell holds where more lights overlap it than it keeps: its list is not kept and a lookup in it loops over every light (the reference stops such a cell at its limit and loses the lights past it). */
export const LIGHT_GRID_OVERFLOW = 0xffffffff

/** The shape of a grid: what its header says and how many words it takes. */
export interface LightGridPlan {
  /** The cells a side; 0 where no local light needs a grid. */
  resolution: number
  maxCount: number
  axis: number
  bytes: number
  stride: number
  suns: number
  countsAt: number
  dataAt: number
  words: number
  /** The rows of the texture that holds the words. */
  rows: number
  /** Whether every light is looped over (the grid is not kept). */
  all: boolean
}

/** The bytes a light's rank takes in a list, for `lights` lights: the smallest of 1, 2 and 4 that holds the ranks 0 to `lights - 1`. */
export const rankBytes = (lights: number) => (lights <= 1 << 8 ? 1 : lights <= 1 << 16 ? 2 : 4)

/**
 * THE GRID FOR `finite` local lights and `suns` lights at infinity among `lights`: the cells a side clamped to 1 to 2048, the lights a cell keeps clamped to 1 to the local lights, the axis;
 * the counts of the three axes' cells (a word each) then their lists, each of `stride` ranks (a rank in the fewest bytes the lights' number allows, a list holding whole words). With no local light
 * there is no grid and the lookup finds the suns alone. Where the grid would take more rows than `maxRows` (the device's texture side), or the suns do not fit the header's row, every light is looped over (`all`).
 */
export function planLightGrid(
  finite: number,
  suns: number,
  lights: number,
  settings: LightGridSettings,
  maxRows: number,
): LightGridPlan {
  const bytes = rankBytes(lights)
  const perWord = 4 / bytes
  const sunsEnd = LIGHT_GRID_HEADER_WORDS + suns
  const resolution = finite > 0 ? clamp(settings.resolution, 1, 2048) : 0
  const maxCount = clamp(settings.maxCount, 1, Math.max(finite, 1))
  const stride = ceilDiv(maxCount, perWord) * perWord
  const cells = resolution * resolution
  const countsAt = sunsEnd
  const dataAt = countsAt + 3 * cells
  const words = resolution > 0 ? dataAt + (3 * cells * stride) / perWord : sunsEnd
  const rows = ceilDiv(words, LIGHT_GRID_WIDTH)
  const all = sunsEnd > LIGHT_GRID_WIDTH || rows > maxRows
  const shape = { bytes, suns, countsAt, dataAt }
  if (all) {
    return {
      ...shape,
      resolution: 0,
      maxCount: 0,
      axis: 0,
      stride: 0,
      words: LIGHT_GRID_HEADER_WORDS,
      rows: 1,
      all,
    }
  }
  return { ...shape, resolution, maxCount, axis: settings.axis, stride, words, rows, all }
}
