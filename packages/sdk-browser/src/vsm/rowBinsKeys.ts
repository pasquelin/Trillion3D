/**
 * HOW A FULL-MAP LOCAL LIGHT IS BINNED (`rowBinsParams.ts`), its key: the axes along which a row's
 * Chebyshev distance is read — a spot's map's clip rows x, y, w; a point light's world axes scaled
 * by the least of its six maps' clip rows, its faces' permutations of them —, the extent a unit of
 * radius takes along them, whether a row leaving the pyramid is past every range, the light's
 * position and its range. A row's s is the least Chebyshev distance of its clip box, e its
 * half-extent and room: the cull drops a row past the range (|d| ≥ s − e) and, for a spot, one
 * whose box leaves the pyramid (max(|x|,|y|) − w > 2e: binned past every range).
 *
 * Keys are made only when the lights' signature changed (`lampKeysOf`): a still scene reads 21
 * numbers a light.
 */
import type { VsmBoundLight } from './rowPageBound.ts'

/** A local light's key: its axes (9 words), then the words below. */
export const AT_SPREAD = 9,
  AT_CONE = 10,
  AT_POSITION = 11,
  AT_RANGE = 14,
  KEY = 15
/** A clip row of `uv` (`vsmShiftedToClip`: x = 2u − w, y = w − 2v, w), its world x, y, z
 *  then its translation. */
const clipRow = (uv: ArrayLike<number>, row: 0 | 1 | 3, k: number) =>
  row === 0
    ? 2 * uv[k * 4] - uv[k * 4 + 3]
    : row === 1
      ? uv[k * 4 + 3] - 2 * uv[k * 4 + 1]
      : uv[k * 4 + 3]
const ROWS = [0, 1, 3] as const

/** A spot's axes — its map's clip rows x, y, w — into `out`'s first nine words; the greatest L1
 *  norm of those rows, or -1 when one has a translation. */
function spotAxes(uv: ArrayLike<number>, out: Float64Array) {
  let spread = 0
  for (const row of ROWS) {
    if (clipRow(uv, row, 3) !== 0) return -1
    let l1 = 0
    for (let k = 0; k < 3; k++) {
      const v = clipRow(uv, row, k)
      out[(row === 3 ? 2 : row) * 3 + k] = v
      l1 += Math.abs(v)
    }
    spread = Math.max(spread, l1)
  }
  return spread
}

/** A point light's axes — the world axes scaled by the least of its six maps' clip rows — into
 *  `out`'s first nine words; the greatest L1 norm of those rows, or -1 when the maps are not a
 *  cube's faces: a row with a translation or reading two world axes, a face missing an axis, or
 *  the six depths not ± each axis once. */
function cubeAxes(
  maps: readonly { projectionData: { shiftedToMapUv: ArrayLike<number> } }[],
  out: Float64Array,
) {
  let spread = 0,
    least = Infinity,
    depths = 0
  for (let m = 0; m < 6; m++) {
    const uv = maps[m].projectionData.shiftedToMapUv
    let columns = 0
    for (const row of ROWS) {
      if (clipRow(uv, row, 3) !== 0) return -1
      let l1 = 0,
        most = 0,
        column = 0
      for (let k = 0; k < 3; k++) {
        const v = Math.abs(clipRow(uv, row, k))
        l1 += v
        if (v > most) {
          most = v
          column = k
        }
      }
      if (l1 !== most || most === 0) return -1
      spread = Math.max(spread, l1)
      least = Math.min(least, most)
      columns |= 1 << column
      if (row === 3) depths |= 1 << (column * 2 + (clipRow(uv, row, column) > 0 ? 1 : 0))
    }
    if (columns !== 7) return -1
  }
  if (depths !== 63) return -1
  out.fill(0, 0, 9)
  for (let k = 0; k < 3; k++) out[k * 4] = least
  return spread
}

/** The key a full-map local light is binned by, or false when its maps are not what the bound
 *  reads: no translation in their clip rows (the light at the translated origin), and a spot's one
 *  map or a point light's six cube faces. */
function localKey(light: VsmBoundLight, out: Float64Array) {
  const maps = light.entry?.mapCaches,
    spot = light.kind === 'spot',
    count = spot ? 1 : 6
  if (!maps || light.count !== count || maps.length < count) return false
  const data = maps[0].projectionData
  const spread = spot ? spotAxes(data.shiftedToMapUv, out) : cubeAxes(maps, out)
  if (spread < 0) return false
  out[AT_SPREAD] = spread
  out[AT_CONE] = spot ? 1 : 0
  for (let k = 0; k < 3; k++) out[AT_POSITION + k] = -data.originShift[k]
  out[AT_RANGE] = data.lightRange
  return true
}

/** Words of a light's signature: its map count, position, range, first map's UV. */
const SIGN = 21
/** Writes `v` at `at`; true when it differed. */
function put(sign: Float64Array, at: number, v: number) {
  if (sign[at] === v) return false
  sign[at] = v
  return true
}

/** Whether the lights changed since the last read — another list, another light, or a light whose
 *  position, range or first map's matrix moved (a point light's faces follow its range) —, the
 *  signature kept for the next. Cheap: no key is made. */
function signed(held: { sign: Float64Array; maps: unknown[] }, lights: readonly VsmBoundLight[]) {
  let changed = false
  if (held.sign.length !== lights.length * SIGN) {
    held.sign = new Float64Array(lights.length * SIGN)
    changed = true
  }
  const sign = held.sign
  for (let i = 0; i < lights.length; i++) {
    const maps = lights[i].entry?.mapCaches,
      at = i * SIGN
    changed = put(sign, at, lights[i].count) || changed
    if (held.maps[i] !== maps) {
      held.maps[i] = maps
      changed = true
    }
    const data = maps?.[0]?.projectionData
    if (!data) continue
    for (let k = 0; k < 3; k++) changed = put(sign, at + 1 + k, data.originShift[k]) || changed
    changed = put(sign, at + 4, data.lightRange) || changed
    for (let k = 0; k < 16; k++) changed = put(sign, at + 5 + k, data.shiftedToMapUv[k]) || changed
  }
  held.maps.length = lights.length
  return changed
}

/** The keys of `lights` (`KEY` words a light), made again only when their signature changed;
 *  undefined when one is not what the bound reads, or none is given. */
export function lampKeysOf(
  held: { sign: Float64Array; maps: unknown[]; keys: Float64Array | undefined },
  lights: readonly VsmBoundLight[],
) {
  if (!signed(held, lights)) return held.keys
  const keys = new Float64Array(lights.length * KEY)
  const known = lights.every((light, i) => localKey(light, keys.subarray(i * KEY, (i + 1) * KEY)))
  held.keys = known && lights.length ? keys : undefined
  return held.keys
}
