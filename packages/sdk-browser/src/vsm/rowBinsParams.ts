/**
 * WHAT A HISTOGRAM IS ASKED WITH (`rowBinsWgsl.ts`): this frame's suns — their light-space x and y,
 * around the camera, the reference a frame then reads its levels from — and the full-map local
 * lights binned jointly, around each light along its maps' clip rows (`rowBinsKeys.ts`), while
 * there are more rows than the worst case's chunk, lamps found unable to beat it left out until
 * they change. The moving rows are binned with
 * their radius grown by how far the moving placements went over the frames a histogram takes to
 * land and be read, twice over (`recentTravel`): a histogram read after they went farther counts
 * them whole (`rowPageBound.ts`). The tag holds what the CPU reads it by (`RowBinsTag`).
 */
import { recentTravel } from '../gpu/shadow/rowMotion.ts'
import { sameValues } from '../../../math/src/matrix/matrixElements.ts'
import { SQRT3 } from '../../../math/src/constants.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import type { VsmClipmap } from './clipmap.ts'
import { BIN_SPAN, E_BINS, rangeCuts } from './rowBins.ts'
import { AT_CONE, AT_POSITION, AT_RANGE, AT_SPREAD, KEY, lampKeysOf } from './rowBinsKeys.ts'
import type { RowBins, RowBinsTag } from './rowBinsRecord.ts'
import { JOINT_WORDS, ROW_BINS_HEAD, ROW_BINS_LAMP, ROW_BINS_SHAPE } from './rowBinsWgsl.ts'
import type { VsmBoundLight, VsmRowSpheres } from './rowPageBound.ts'

/** Suns a histogram bins at most: past them, the bound keeps the worst case. */
const MAX_SUNS = 4

/** The world directions of a clipmap's light-space x and y axes. */
export const sunAxes = (m: ArrayLike<number>, out = new Float64Array(6)) => {
  for (let k = 0; k < 3; k++) {
    out[k] = m[k * 4]
    out[3 + k] = m[k * 4 + 1]
  }
  return out
}

/** `origin` split as the spheres are: high f32, then the rest as an f32. */
function splitRef(origin: ArrayLike<number>, out = new Float64Array(6)) {
  for (let k = 0; k < 3; k++) {
    out[k] = Math.fround(origin[k])
    out[3 + k] = Math.fround(origin[k] - out[k])
  }
  return out
}

/** `v` as the nearest f32 at or above it. */
const f32Up = (v: number) => {
  const f = Math.fround(v)
  return f >= v ? f : Math.fround(f + Math.abs(f) * 2 ** -23)
}

/** Each light's range cuts, made once a set of keys. */
const cutsOf = new WeakMap<Float64Array, Uint32Array>()
function cuts(keys: Float64Array) {
  let held = cutsOf.get(keys)
  if (held) return held
  const lamps = keys.length / KEY
  held = new Uint32Array(lamps * E_BINS)
  for (let l = 0; l < lamps; l++)
    rangeCuts(keys[l * KEY + AT_RANGE], held.subarray(l * E_BINS, (l + 1) * E_BINS))
  cutsOf.set(keys, held)
  return held
}

let words = new Uint32Array(ROW_BINS_HEAD)
let floats = new Float32Array(words.buffer)

/** A shape at `at`: nine axes (a sun's third zero), the reference split, the extent a unit of
 *  radius, the scale of the f32 room of a row's distance, whether a row leaving the pyramid is past
 *  every range. */
function shape(
  at: number,
  axes: ArrayLike<number>,
  ref: Float64Array,
  [spread, roomScale, cone]: readonly [number, number, number],
) {
  for (let k = 0; k < 9; k++) floats[at + k] = k < axes.length ? axes[k] : 0
  for (let k = 0; k < 6; k++) floats[at + 9 + k] = ref[k]
  floats[at + 15] = spread
  floats[at + 16] = roomScale
  words[at + 17] = cone
}
/** A sun's: the cull's extent bound r·√3 of a unit rotation, its room unscaled. */
const SUN: readonly [number, number, number] = [SQRT3, 1, 0]

/** The full-map lights and the suns `lights` render, or undefined when a directional light comes
 *  without its clipmap. */
export function boundLights(lights: readonly VsmBoundLight[]) {
  const suns: VsmClipmap[] = [],
    maps: VsmBoundLight[] = []
  for (const light of lights) {
    if (!light.shouldRender) continue
    if (light.kind === 'directional') {
      if (!light.clipmap) return undefined
      suns.push(light.clipmap)
    } else if (!light.singlePage) maps.push(light)
  }
  return { suns, maps }
}

/**
 * The histogram of rows `[first, end)` of `spheres` this frame asks under `lights`: its tag and its
 * parameters' words (valid until the next ask), or undefined when it would bound nothing — too many
 * suns, no sun nor lamp to bin.
 */
export function rowBinsRequest(
  bins: RowBins,
  spheres: VsmRowSpheres,
  range: { first: number; end: number },
  lights: readonly VsmBoundLight[],
) {
  const frame = boundLights(lights)
  if (range.end <= range.first || !frame || frame.suns.length > MAX_SUNS) return
  // The lamps' bins, a light a row, only when they may pay and can beat the worst case.
  let keys = frame.maps.length && bins.pays ? lampKeysOf(bins, frame.maps) : undefined
  if (keys && bins.hopeless && sameValues(keys, bins.hopeless)) keys = undefined
  const suns = frame.suns.length,
    lamps = keys ? keys.length / KEY : 0
  if (!suns && !lamps) return
  const size = ROW_BINS_HEAD + suns * ROW_BINS_SHAPE + lamps * ROW_BINS_LAMP
  if (words.length < size) {
    words = resized(words, size)
    floats = new Float32Array(words.buffer)
  }
  const { motion } = spheres,
    margin = f32Up(recentTravel(motion, 2 * bins.latency + 1)),
    jointAt = suns * 2 * BIN_SPAN
  words.set([range.first, range.end, suns, lamps, 0, jointAt, 0, 0])
  floats[4] = margin
  const binned = frame.suns.map((clipmap, s) => {
    const sun = {
      clipmap,
      axes: sunAxes(clipmap.lightViewRotation),
      ref: splitRef(clipmap.eyeWorld),
    }
    shape(ROW_BINS_HEAD + s * ROW_BINS_SHAPE, sun.axes, sun.ref, SUN)
    return sun
  })
  const lampsAt = ROW_BINS_HEAD + suns * ROW_BINS_SHAPE
  for (let l = 0; l < lamps; l++) {
    const key = keys!.subarray(l * KEY, (l + 1) * KEY),
      at = lampsAt + l * ROW_BINS_LAMP
    const spread = key[AT_SPREAD]
    shape(at, key, splitRef(key.subarray(AT_POSITION, AT_RANGE)), [spread, spread, key[AT_CONE]])
    words.set(cuts(keys!).subarray(l * E_BINS, (l + 1) * E_BINS), at + ROW_BINS_SHAPE)
  }
  const tag: RowBinsTag = {
    seq: ++bins.seq,
    spheres,
    first: range.first,
    end: range.end,
    derived: motion.derived,
    travel: motion.travel,
    commits: motion.commits,
    margin,
    suns: binned,
    lampKeys: keys,
    jointAt,
    words: jointAt + (lamps ? JOINT_WORDS : 0),
  }
  return { tag, params: words.subarray(0, size) }
}
