import type { HairStrandsGroup } from '../../../sdk-core/src/hair/hairStrandsFile.ts'
import { alignUp } from '../../../math/src/scalar/integers.ts'
import { HAIR_TANGENT_BYTES } from './tangentBytes.ts'

/**
 * The buffers of one group of strands as the passes bind them, both storage: the points (eight
 * bytes each) and the tangents (written once, `HAIR_TANGENT_BYTES` a point). Whole: no buffer
 * outgrows what a group may hold (`HAIR_STRANDS_MAX_POINTS_PER_GROUP` points of eight bytes fill
 * 128 MiB less 8 bytes, the least a device's storage binding grants), so none is split. The curves
 * (a word each: the first point and the count) are there for the passes that walk a strand; the attributes
 * are put there by the pass that reads them: the strands' material is the default strand material's, which
 * reads none of them.
 */
export interface HairGroupGpu {
  /** The bits of `HAIR_STRANDS_FLAG_*` the group was built with. */
  readonly flags: number
  readonly pointCount: number
  readonly points: GPUBuffer
  readonly tangents: GPUBuffer
  readonly curveCount: number
  readonly curves: GPUBuffer
  /** The box of the points; the positions are relative to the centre of it, `positionOffset`. */
  readonly boundsMin: readonly [number, number, number]
  readonly boundsMax: readonly [number, number, number]
  readonly positionOffset: readonly [number, number, number]
  readonly maxLength: number
  readonly maxRadius: number
  /** Whether the tangents have been written. */
  tangentsWritten: boolean
  destroy(): void
}

/** The buffers of `group` on `device`, its tangents not yet written; `readback` is the usage a proof
 *  that reads the tangents back adds. */
export function createHairGroup(
  device: GPUDevice,
  group: HairStrandsGroup,
  label: string,
  readback: GPUBufferUsageFlags,
): HairGroupGpu {
  const points = device.createBuffer({
    label: `${label} points`,
    size: Math.max(4, alignUp(group.points.byteLength, 4)),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(points, 0, group.points)
  const tangents = device.createBuffer({
    label: `${label} tangents`,
    size: group.pointCount * HAIR_TANGENT_BYTES,
    usage: GPUBufferUsage.STORAGE | readback,
  })
  const curves = device.createBuffer({
    label: `${label} curves`,
    size: Math.max(4, alignUp(group.curves.byteLength, 4)),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(curves, 0, group.curves)
  const centre = (axis: number) =>
    Math.fround(Math.fround(group.boundsMin[axis]! + group.boundsMax[axis]!) * 0.5)
  return {
    flags: group.flags,
    pointCount: group.pointCount,
    points,
    tangents,
    curveCount: group.curveCount,
    curves,
    boundsMin: group.boundsMin,
    boundsMax: group.boundsMax,
    positionOffset: [centre(0), centre(1), centre(2)],
    maxLength: group.maxLength,
    maxRadius: group.maxRadius,
    tangentsWritten: false,
    destroy() {
      points.destroy()
      tangents.destroy()
      curves.destroy()
    },
  }
}
