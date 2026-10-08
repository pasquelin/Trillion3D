import { boxEmpty, boxExpandByPoint } from '../../../../math/src/geometry/box.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'

/** The compiler's conservative rest balls and target radii, measured once for page-authored data. */
export function runtimeDeformation(drawn: DrawnTriangles) {
  const source = drawn.deformation
  if (!source) return undefined
  const width = source.influences ?? 4
  const boxes: Float64Array[] = []
  if (source.joints && source.weights)
    for (let v = 0; v < drawn.positions.length / 3; v++)
      for (let influence = 0; influence < width; influence++) {
        const at = v * width + influence
        if (source.weights[at] <= 0) continue
        const joint = source.joints[at]
        if (!Number.isInteger(joint) || joint < 0 || joint > 65535)
          throw new RangeError('Invalid skin joint')
        let box = boxes[joint]
        if (!box) {
          box = boxes[joint] = new Float64Array(6)
          boxEmpty(box, 0)
        }
        const p = v * 3
        boxExpandByPoint(box, 0, drawn.positions[p], drawn.positions[p + 1], drawn.positions[p + 2])
      }
  const joints: number[] = []
  for (let joint = 0; joint < boxes.length; joint++) {
    const box = boxes[joint]
    if (!box) {
      joints.push(0, 0, 0, 0)
      continue
    }
    const x = (box[0] + box[3]) / 2,
      y = (box[1] + box[4]) / 2,
      z = (box[2] + box[5]) / 2
    joints.push(x, y, z, length3(box[3] - x, box[4] - y, box[5] - z))
  }
  const targets = source.targets.map(({ positions }) => {
    let radius = 0
    for (let v = 0; v < positions.length; v += 3)
      radius = Math.max(radius, length3(positions[v], positions[v + 1], positions[v + 2]))
    return radius
  })
  return { joints, targets }
}
