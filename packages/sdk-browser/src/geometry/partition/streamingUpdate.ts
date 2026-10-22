/**
 * WHEN THE VIEW'S STREAMING UPDATE RUNS (`cells.ts`): the cells the view wishes are planned again
 * (`plan.ts`) only once what they read moved enough, not at every step of the eye or the axis.
 *
 * Each frame (`due`) the view is reduced to a key. Its position, in metres of the world the
 * camera stands in — before the frame of the scene's root, whatever a model is scaled to —, is cut
 * into squares of `locationQuantization`: its two ground axes, and its height too when the key is
 * 3D, as it is on `hashSet`'s loose grids and on `spatialHash`'s when the settings cull by height
 * (`zCulling`). Its yaw is cut into steps of `rotationQuantization` degrees, and, in 3D, its pitch
 * (the view has no roll). The key also holds the settings that shape what the view wishes: the
 * state it asks of the cells, the shape's own (`SOURCE_SHAPE`), whether a blocking grid blocks,
 * and whether the HLOD actors are on. A quantization of 0 keeps the exact value.
 *
 * The update runs when the key differs from the last update's, or when the scene root's world, or
 * a core parent, moved: the one term this key has that the source's has not. The cells of a scene
 * hang under nodes a host moves, and the bounds the plan reads move with them (`boxes.ts`) while
 * the view stands; without the term such a cell is never wished (`cells.test.ts`, "a core parent
 * or the scene root that moved wishes the cells it brought into range"). It runs at every frame
 * while it may not be skipped: the optimisation off (`updateOptimization`,
 * or both quantizations 0), or the last frame left work (`end`), or a load blocking, or the
 * initial load, or every `forceUpdateFrames`th frame. The first update after such a frame always
 * runs, whatever the key. A frame that skips it goes on with the last plan.
 *
 * The position and the rotation the key reads are the view's own when it lies farther than a
 * quantum from the world's origin (Euclidean for the position, the sum of the angles' magnitudes
 * for the rotation) and none otherwise, afresh at each frame: no position or rotation is kept
 * from one frame to the next. The yaw is always the view's own: its heading on the ground, which
 * a view looking straight up or down takes from its up vector (`aimOf`).
 *
 * Cost: O(1) per frame, O(core parents) to see one move.
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { RAD2DEG } from '../../../../math/src/constants.ts'
import { directionYawPitch } from '../../../../math/src/vector/spherical.ts'
import { keepNumbers, length3 } from '../../../../math/src/vector/vector.ts'
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { SOURCE_SHAPE } from './source.ts'

/** The settings that shape what the view wishes, each a number in the key (a switch 0 or 1). */
const SHAPING = [
  ...SOURCE_SHAPE,
  'blockOnSlowStreaming',
  'hlod',
  'priority',
  'useVelocity',
] as const
/** What the key holds after the shaping settings: the position on the ground, the yaw, the
 *  height and the pitch. */
const VIEW_VALUES = 5
/** The key's length: whether it is 3D and the target state, the shaping settings, the view. */
const KEY_LENGTH = 2 + SHAPING.length + VIEW_VALUES
/** The axis of a view that gives none. */
const NO_AXIS = [0, 0, 0]

/** `value` cut into steps of `step`, or `value` itself when the step is none. */
const cut = (value: number, step: number) => (step > 0 ? Math.floor(value / step) : value)

/** The key of the view at `eye` looking along the unit `axis`, heading `aim` on the ground, into
 *  `key`, `threeD` or not, `angles` its scratch. */
function writeKey(
  key: Float64Array,
  angles: Float64Array,
  streaming: WorldStreaming,
  threeD: boolean,
  eye: ArrayLike<number>,
  axis: ArrayLike<number>,
  aim: ArrayLike<number>,
) {
  const { locationQuantization: place, rotationQuantization: turn } = streaming
  let at = 0
  key[at++] = threeD ? 1 : 0
  key[at++] = streaming.targetState === 'loaded' ? 1 : 0
  for (const field of SHAPING) key[at++] = Number(streaming[field])
  // The view's rotation in degrees: yaw clockwise seen from above, 0 along -Z; pitch up.
  directionYawPitch(angles, axis[0], axis[1], axis[2])
  const pitch = angles[1] * RAD2DEG
  if (aim !== axis) directionYawPitch(angles, aim[0], 0, aim[2])
  const yaw = -angles[0] * RAD2DEG
  // The rotation kept is the view's own past a quantum from none, the roll 0.
  const turned = Math.abs(yaw) + Math.abs(pitch) > turn
  const moved = length3(eye[0], eye[1], eye[2]) > place
  key[at++] = cut(moved ? eye[0] : 0, place)
  key[at++] = cut(moved ? eye[2] : 0, place)
  key[at++] = cut(yaw, turn)
  key[at++] = threeD ? cut(moved ? eye[1] : 0, place) : 0
  key[at] = threeD ? cut(turned ? pitch : 0, turn) : 0
}

/** Whether a core parent's frame in `frames` is not the one `seen` holds: made anew when the
 *  parent moves (`CellBoxes.stretch`). `seen` follows `frames`, ranks gone forgotten, and is
 *  written only for what moved. */
function framesMoved(seen: Map<number, unknown>, frames: ReadonlyMap<number, unknown>) {
  let moved = false
  for (const rank of frames.keys()) {
    const frame = frames.get(rank)
    if (seen.get(rank) === frame) continue
    moved = true
    seen.set(rank, frame)
  }
  if (seen.size !== frames.size) {
    moved = true
    for (const rank of seen.keys()) if (!frames.has(rank)) seen.delete(rank)
  }
  return moved
}

/** The update of a partition of `scheme` under the settings `streaming` holds as they stand. */
export function createStreamingUpdate(streaming: WorldStreaming, scheme: TablePartition['scheme']) {
  const key = new Float64Array(KEY_LENGTH),
    last = new Float64Array(KEY_LENGTH),
    angles = new Float64Array(2),
    root = new Float64Array(MATRIX_VALUES).fill(NaN)
  const seen = new Map<number, unknown>()
  /** Whether the last frame was an update that kept its key, whether it left no work, and how many
   *  frames were seen. */
  let known = false,
    quiet = false,
    counted = 0
  return {
    /** Whether the update runs for the view at `eye` looking along the unit `axis`, heading `aim`
     *  on the ground (`aimOf`), all in the world's units, the scene root's world being `world` and
     *  the core parents' frames (`CellBoxes.stretch`) `frames`, unless a load is `blocked`: the
     *  key is kept as the last update's while the update may be skipped. */
    due(
      eye: ArrayLike<number>,
      axis: ArrayLike<number> | undefined,
      aim: ArrayLike<number> | undefined,
      world: ArrayLike<number>,
      blocked: boolean,
      frames: ReadonlyMap<number, unknown>,
    ) {
      const every = streaming.forceUpdateFrames
      counted++
      const skippable =
        quiet &&
        !blocked &&
        !(every > 0 && counted % every === 0) &&
        streaming.updateOptimization &&
        (streaming.locationQuantization > 0 || streaming.rotationQuantization > 0)
      if (!skippable) {
        known = false
        return true
      }
      const threeD = scheme === 'hashSet' || streaming.zCulling
      const looking = axis ?? NO_AXIS
      writeKey(key, angles, streaming, threeD, eye, looking, aim ?? looking)
      const rooted = keepNumbers(root, world),
        parents = !framesMoved(seen, frames)
      let same = known && rooted && parents
      for (let at = 0; same && at < KEY_LENGTH; at++) same = key[at] === last[at]
      last.set(key)
      known = true
      return !same
    },
    /** The frame ends, leaving work (`busy`) or none: an update may be skipped from the next frame
     *  on once none is left. */
    end(busy: boolean) {
      quiet = !busy
    },
    /** The next frame's update runs, the view's wishes lost (`close`). */
    reset() {
      known = quiet = false
    },
  }
}

export type StreamingUpdate = ReturnType<typeof createStreamingUpdate>
