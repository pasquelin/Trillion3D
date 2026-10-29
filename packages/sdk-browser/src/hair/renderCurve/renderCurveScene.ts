import { clamp } from '../../../../math/src/scalar/reals.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import type { HairScene, HairInstance } from '../scene.ts'
import { buildRenderCurveClusters, renderCurvePointsPerCurve } from './clusterBuild.ts'
import { RENDER_CURVE_INSTANCE_WORDS, renderCurveClusterStride } from './renderCurveMath.ts'

/** The clusters of every group of a scene on the GPU, the record of each instance, and where each group's clusters begin. */
export interface RenderCurveSceneGpu {
  readonly scene: HairScene
  readonly clusters: GPUBuffer
  readonly instances: GPUBuffer
  readonly clusterCount: number
  readonly strideWords: number
  /** The first cluster of each group and the clusters it holds. */
  readonly offsets: readonly number[]
  readonly counts: readonly number[]
  readonly words: { readonly u: Uint32Array; readonly f: Float32Array }
  dispose(): void
}

/**
 * The clusters of the groups of `scene` (`buildRenderCurveClusters`) in one buffer, one group after the other, and the buffer of the
 * instances' records, whose boxes and cluster ranges are written here and whose transforms are written each image
 * (`writeRenderCurveInstances`). The clusters past what one storage binding of `capBytes` holds are left out.
 */
export function createRenderCurveScene(
  device: GPUDevice,
  scene: HairScene,
  capBytes: number,
): RenderCurveSceneGpu {
  const { groups } = scene.strands
  const pointsPerCurve = renderCurvePointsPerCurve(groups)
  const stride = renderCurveClusterStride(pointsPerCurve)
  const fits = Math.max(1, Math.floor(capBytes / stride))
  const offsets: number[] = []
  const counts: number[] = []
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let clusterCount = 0
  for (const group of groups) {
    const built = buildRenderCurveClusters(group, pointsPerCurve)
    const kept = clamp(fits - clusterCount, 0, built.clusterCount)
    offsets.push(clusterCount)
    counts.push(kept)
    chunks.push(built.data.subarray(0, kept * stride))
    clusterCount += kept
  }
  const clusters = device.createBuffer({
    label: 'hair curve raster clusters',
    size: Math.max(4, clusterCount * stride),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  let at = 0
  for (const chunk of chunks) {
    if (chunk.byteLength) device.queue.writeBuffer(clusters, at, chunk)
    at += chunk.byteLength
  }
  const count = scene.instances.length
  const instances = device.createBuffer({
    label: 'hair curve raster instances',
    size: Math.max(4, count * RENDER_CURVE_INSTANCE_WORDS * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const buffer = new ArrayBuffer(count * RENDER_CURVE_INSTANCE_WORDS * 4)
  const words = { u: new Uint32Array(buffer), f: new Float32Array(buffer) }
  for (const instance of scene.instances) {
    const { group, registeredIndex } = instance
    const first = registeredIndex * RENDER_CURVE_INSTANCE_WORDS
    words.u[first] = offsets[registeredIndex]!
    words.u[first + 1] = counts[registeredIndex]!
    for (let axis = 0; axis < 3; axis++) {
      words.f[first + 4 + axis] =
        (group.boundsMin[axis]! + group.boundsMax[axis]!) * 0.5 - group.positionOffset[axis]!
      words.f[first + 8 + axis] =
        (group.boundsMax[axis]! - group.boundsMin[axis]!) * 0.5 + group.maxRadius
    }
  }
  return {
    scene,
    clusters,
    instances,
    clusterCount,
    strideWords: stride / 4,
    offsets,
    counts,
    words,
    dispose: () =>
      retire(device, {
        destroy() {
          clusters.destroy()
          instances.destroy()
        },
      }),
  }
}

/**
 * Writes the transform of every instance to the translated world seen from `eye` (the group's space, whose origin is the centre of its
 * box, taken to the world, column-major, then the eye taken away) into the instances' buffer.
 */
export function writeRenderCurveInstances(
  device: GPUDevice,
  held: RenderCurveSceneGpu,
  instances: readonly HairInstance[],
  eye: ArrayLike<number>,
) {
  const { f } = held.words
  for (const instance of instances) {
    const at = instance.registeredIndex * RENDER_CURVE_INSTANCE_WORDS + 12
    const m = instance.localToWorld
    const offset = instance.group.positionOffset
    for (let i = 0; i < 12; i++) f[at + i] = m[i]!
    for (let axis = 0; axis < 3; axis++)
      f[at + 12 + axis] =
        m[12 + axis]! +
        m[axis]! * offset[0]! +
        m[4 + axis]! * offset[1]! +
        m[8 + axis]! * offset[2]! -
        eye[axis]!
    f[at + 15] = 1
  }
  device.queue.writeBuffer(held.instances, 0, f.buffer, 0, f.byteLength)
}
