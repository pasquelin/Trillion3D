import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { castWebgpuRay } from '../../frame/io/castRay.ts'
import { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { blendNodeOf, rootSource } from '../../placement/hidden.ts'
import { MOVABLE_ROOT } from '../../visibility/shader/castingMark.ts'
import { readSingleLayerWaterSetting } from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'

/** The height of the scene's geometry under the surface of the body carried by `node` at the camera's xz, when known. */
export type FloorUnder = (
  node: Object3D | undefined,
  box: ArrayLike<number>,
  level: number,
  eye: ArrayLike<number>,
) => number | undefined

/**
 * What a ray cast down from a body's surface found at the camera's xz (the body's own volume ends on the scene's static, opaque
 * geometry: the floor of a lake, not a boat, a character or a debris piece on it, nor another translucent surface).
 */
interface Floor {
  /** The camera's xz the last cast was made at. */
  x: number
  z: number
  /** The height it met; none: nothing under, or no answer yet. */
  y: number | undefined
  /** Whether the answer is in for `x`, `z`. */
  answered: boolean
  /** A cast is in flight, and the number of the cast whose answer counts (a later one replaces it). */
  pending: boolean
  serial: number
  /** The frame of the last cast and the empty answers since the camera moved (retried, a few times). */
  frame: number
  misses: number
}

const floors = new WeakMap<object, Floor>()
/** How far the camera moves across before a floor is cast again, metres; past `JUMP` the held answer is of another place. */
const STEP = 1
const JUMP = 50
/** The frames between two casts of one body, and how many times an empty answer is asked again for the same place. */
const SPACING = 8
const RETRIES = 3
const DOWN = new Vector3(0, -1, 0)
const origin = new Vector3()
/** The nodes a cast passes through, refilled each cast. */
const skipped: Object3D[] = []

/** Fills `skipped` with what the cast must not meet: the body, the translucent surfaces, and the objects that move (a skin, a morph or a
 *  deformation, a node that says it is movable). What is left is the scene's static, opaque geometry. */
function skipDynamic(rt: WebgpuPagesRuntime, body: Object3D) {
  skipped.length = 0
  skipped.push(body)
  for (const item of rt.blendState.blendGpu) {
    const node = blendNodeOf(item)
    if (node) skipped.push(node)
  }
  for (const root of rt.layout.selectionRoots) {
    if (!root.deformation && ((root.mark ?? 0) & MOVABLE_ROOT) === 0) continue
    const node = rootSource(root)
    if (node) skipped.push(node)
  }
  return skipped
}

function cast(
  rt: WebgpuPagesRuntime,
  floor: Floor,
  node: Object3D,
  level: number,
  eye: ArrayLike<number>,
) {
  floor.pending = true
  floor.answered = false
  floor.x = eye[0]
  floor.z = eye[2]
  floor.frame = rt.run.frame
  const serial = ++floor.serial
  const settle = (y: number | undefined) => {
    // A later cast, for another place, replaced this one.
    if (serial !== floor.serial) return
    floor.y = y
    floor.pending = false
    floor.answered = true
    floor.misses = y === undefined ? floor.misses + 1 : 0
  }
  origin.set(eye[0], level, eye[2])
  castWebgpuRay(rt, new Ray(origin, DOWN), { skip: skipDynamic(rt, node) }).then(
    (hit) => settle(hit?.point.y),
    () => settle(undefined),
  )
}

/**
 * The floor under the body of `node` at the camera, from the session's ray query: cast when the camera has moved a metre across (at most
 * once in `SPACING` frames, at once for a jump), asked again a few times when it found nothing. The answer is that of the camera's place:
 * none (the body's own box) while the cast for a new place is in flight, past a jump, and for a camera that is not over the body (within
 * the trace distance of it) or higher above its surface than that.
 */
function floorUnder(
  rt: WebgpuPagesRuntime,
  node: Object3D | undefined,
  box: ArrayLike<number>,
  level: number,
  eye: ArrayLike<number>,
) {
  if (!node) return undefined
  const trace = readSingleLayerWaterSetting(rt, 'singleLayerWaterUnderwaterTraceDistance')
  if (
    eye[0] < box[0] - trace ||
    eye[0] > box[3] + trace ||
    eye[2] < box[2] - trace ||
    eye[2] > box[5] + trace ||
    eye[1] > level + trace
  )
    return undefined
  let floor = floors.get(node)
  if (!floor)
    floors.set(
      node,
      (floor = {
        x: NaN,
        z: NaN,
        y: undefined,
        answered: false,
        pending: false,
        serial: 0,
        frame: -Infinity,
        misses: 0,
      }),
    )
  const away = Math.max(Math.abs(eye[0] - floor.x), Math.abs(eye[2] - floor.z))
  const moved = !(away <= STEP)
  const waited = rt.run.frame - floor.frame >= SPACING
  const retry = floor.answered && floor.y === undefined && floor.misses <= RETRIES
  if (away > JUMP || (!floor.pending && waited && (moved || retry))) {
    if (moved) floor.misses = 0
    cast(rt, floor, node, level, eye)
  }
  return floor.answered && !moved ? floor.y : undefined
}

/** The floor query of a runtime, made once (no closure an image). */
const queries = new WeakMap<WebgpuPagesRuntime, FloorUnder>()
export function floorOf(rt: WebgpuPagesRuntime): FloorUnder {
  let query = queries.get(rt)
  if (!query)
    queries.set(rt, (query = (node, box, level, eye) => floorUnder(rt, node, box, level, eye)))
  return query
}
