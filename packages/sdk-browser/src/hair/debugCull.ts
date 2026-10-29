import { DEBUG_COLORS, type DebugLines } from './debugLines.ts'

/** The half of the world's side the box of a directional light's bound has (200 km, in metres): the bound of a light that shines everywhere. */
const LIGHT_BOUND_RADIUS = 200_000
/** The depths of the clip box the view's frustum is drawn between. */
const FRUSTUM_NEAR = 0.0001
const FRUSTUM_FAR = 0.9999

/** A groom the sun's test was asked of, for the debug view: the sun (its rank among the lights that cast), its frame (nine numbers, the rows of its axes), the groom's box
 *  in that frame (extended along the sun's direction) and in the world (six numbers each), and whether the extended box reaches the camera's frustum. */
export interface HairCullEntry {
  light: number
  readonly axes: Float64Array
  readonly inLight: Float64Array
  readonly inWorld: Float64Array
  reached: boolean
}

/**
 * THE TRACE OF THE SUN'S TEST OF THE GROOMS OUT OF VIEW (`hairCastShadowWhenOutOfViewDebug`): while `on`, the test
 * (`hairReachedByLight`) asks every sun, not only until one reaches the groom, and keeps what it found in `entries`
 * (`count` of them, refilled in place by each image). A view holds its own.
 */
export interface HairCullTrace {
  on: boolean
  count: number
  readonly entries: HairCullEntry[]
}

/** An empty trace, unarmed. */
export const createHairCullTrace = (): HairCullTrace => ({ on: false, count: 0, entries: [] })

/** Arms the trace for an image (`on`) and empties it. */
export function armHairCullTrace(trace: HairCullTrace, on: boolean) {
  trace.on = on
  trace.count = 0
}

/** Keeps what the test of the sun `light` found for a groom: its frame `axes`, its box in the frame (`inLight`) and in the world (`inWorld`), and whether it reached the frustum. */
export function recordHairCull(
  trace: HairCullTrace,
  light: number,
  axes: ArrayLike<number>,
  inLight: ArrayLike<number>,
  inWorld: ArrayLike<number>,
  reached: boolean,
) {
  const entry = (trace.entries[trace.count] ??= {
    light: 0,
    axes: new Float64Array(9),
    inLight: new Float64Array(6),
    inWorld: new Float64Array(6),
    reached: false,
  })
  trace.count++
  entry.light = light
  for (let k = 0; k < 9; k++) entry.axes[k] = axes[k]!
  for (let k = 0; k < 6; k++) {
    entry.inLight[k] = inLight[k]!
    entry.inWorld[k] = inWorld[k]!
  }
  entry.reached = reached
}

/**
 * Draws the trace: the view's frustum in blue, the bound of each sun that tested a groom in purple, each groom's box in its sun's frame
 * green where it reaches the frustum and yellow where it does not, and in the world in red. `viewProjection` is the camera's clip from
 * the world. Nothing while no groom was tested.
 */
export function drawHairCull(
  lines: DebugLines,
  trace: HairCullTrace,
  viewProjection: ArrayLike<number>,
) {
  const { count, entries } = trace
  if (!count) return
  lines.frustum(viewProjection, FRUSTUM_NEAR, FRUSTUM_FAR, DEBUG_COLORS.blue)
  const drawn = new Set<number>()
  const bound = LIGHT_BOUND_RADIUS
  for (let at = 0; at < count; at++) {
    const entry = entries[at]!
    if (!drawn.has(entry.light)) {
      drawn.add(entry.light)
      lines.box([-bound, -bound, -bound], [bound, bound, bound], DEBUG_COLORS.purple)
    }
    const low = entry.inLight.subarray(0, 3)
    const high = entry.inLight.subarray(3, 6)
    lines.box(low, high, entry.reached ? DEBUG_COLORS.green : DEBUG_COLORS.yellow, entry.axes)
    lines.box(entry.inWorld.subarray(0, 3), entry.inWorld.subarray(3, 6), DEBUG_COLORS.red)
  }
}
