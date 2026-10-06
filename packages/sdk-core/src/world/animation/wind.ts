import {
  axisAngleQuaternion,
  multiplyQuaternion,
  rotateByQuaternion,
} from '../../math/matrix/quaternion.ts'
import type { Object3D } from '../object/object3d.ts'
import type { Clip, Track } from './clip.ts'

/** Keys per sway: the arc between two keys leaves the sine it follows by under one percent of
 *  the sway (`1 − cos(π / 24)`). */
const KEYS = 24

/** How the wind blows: where to (`x`, `z` on the ground), the most a bone bends, in radians, and
 *  how many sways a second. */
export interface WindOptions {
  /** Ground-plane direction `[x, z]`; defaults to `[1, 0]`. */
  direction?: readonly [number, number]
  /** Maximum bend in radians; defaults to 0.1. */
  angle?: number
  /** Sways per second; defaults to 0.5. */
  frequency?: number
}

/**
 * Wind drives foliage by its bones, not by moving vertices one by one, so a
 * tree's bounds follow the bones it bends by. A looping clip turns each bone, from its rest
 * pose, about the axis across the wind, by at most `angle`: leant with the wind and swaying back,
 * each bone further along the list — further from the trunk — bending more and later. Played by a
 * mixer like any clip: `mixer.clipAction(animation.windClip(bones)).play()`.
 */
export function windClip(bones: readonly Object3D[], options: WindOptions = {}): Clip {
  const [dx, dz] = options.direction ?? [1, 0],
    reach = Math.hypot(dx, dz) || 1,
    across = [dz / reach, 0, -dx / reach],
    angle = options.angle ?? 0.1,
    period = 1 / (options.frequency ?? 0.5)
  const times = Array.from({ length: KEYS + 1 }, (_, k) => (k / KEYS) * period)
  const turn = new Float64Array(4),
    posed = new Float64Array(4)
  const tracks: Track[] = bones.map((bone, i) => {
    const depth = (i + 1) / bones.length,
      rest = [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w]
    // The axis across the wind, in the frame the bone's rotation is written in: its parent's.
    const parent = bone.parent?.getWorldQuaternion(),
      local = new Float64Array(3)
    const unturned = parent ? [-parent.x, -parent.y, -parent.z, parent.w] : [0, 0, 0, 1]
    rotateByQuaternion(local, unturned, across[0], across[1], across[2])
    const values = times.flatMap((time) => {
      const phase = (2 * Math.PI * time) / period - depth * Math.PI * 0.5
      axisAngleQuaternion(turn, local, angle * depth * (0.6 + 0.4 * Math.sin(phase)))
      return Array.from(multiplyQuaternion(posed, turn, rest))
    })
    return {
      name: `${bone.name}.quaternion`,
      kind: 'quaternion',
      times: new Float32Array(times),
      values: new Float32Array(values),
    }
  })
  return { name: 'wind', duration: period, tracks }
}
