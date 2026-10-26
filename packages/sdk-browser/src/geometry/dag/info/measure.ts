import { autoKernel } from '../../../gpu/core/computeStages.ts'
import { bufferEntries } from '../../../gpu/core/computeBindings.ts'
import { heldGroup } from '../../../gpu/bind/bindIdentity.ts'
import { dispatchRows } from '../../../gpu/dispatch/grid.ts'
import { sizedBuffer } from '../../../gpu/core/sizedBuffer.ts'
import { resized } from '../../../../../math/src/sequence/resized.ts'
import { CLUSTER_MEASURE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { measureSource } from './measureWgsl.ts'

/** The measure kernel, once a device, compiled off the thread. */
const measureKernel = autoKernel(CLUSTER_MEASURE_PASS, measureSource(), 'measure')

/** What the measure reads and writes beside its list: the geometry pool's words and floats, the cluster
 *  records and the edges the cut holds (`GpuSelection.info`, `GpuSelection.edges`). */
export type MeasureBuffers = {
  indices: GPUBuffer
  positions: GPUBuffer
  info: GPUBuffer
  edges: GPUBuffer
}

/** The group over `buffers`, the list `listed` and the `count`, made again when one moved. */
function bindMeasure(
  device: GPUDevice,
  held: ReturnType<typeof heldGroup>,
  count: GPUBuffer,
  pipeline: GPUComputePipeline,
  buffers: MeasureBuffers,
  listed: GPUBuffer,
) {
  const { next } = held.identity
  next[0] = pipeline
  next[1] = buffers.indices
  next[2] = buffers.positions
  next[3] = buffers.info
  next[4] = buffers.edges
  next[5] = listed
  next.length = 6
  if (held.identity.moved())
    held.group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        ...bufferEntries([buffers.indices, buffers.positions, buffers.info, buffers.edges, listed]),
        { binding: 5, resource: { buffer: count } },
      ],
    })
}

/**
 * THE MEASURE OF THE CLUSTERS' LONGEST EDGE, `measureWgsl.ts`: the records the cluster residency wrote
 * for clusters never measured (`queue`) are listed, and the frame's next cut finds their edges
 * measured (`encode`, before it): a cluster is measured once, when its page arrives, however many
 * placements draw it and however often it moves in the pool. Nothing is encoded for a frame that
 * lists none, nor while the kernel is not compiled (`ask`): the records stay listed, their edges
 * zero — a cluster of no edge goes to the hardware raster — until it is.
 */
export function createClusterMeasure(device: GPUDevice) {
  let listed = new Uint32Array(64),
    pending = 0
  let buffer: GPUBuffer | undefined
  const count = device.createBuffer({
    label: 'Trillion3D cluster measure count',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const held = heldGroup()
  const words = new Uint32Array(4)
  return {
    /** Asks the kernel off the thread: the frame waits for it. */
    ask: () => measureKernel(device).ask(),
    /** The first `n` of `records` listed to be measured at the next `encode`. */
    queue(records: Uint32Array, n: number) {
      listed = resized(listed, pending + n)
      listed.set(records.subarray(0, n), pending)
      pending += n
    },
    /** The records listed and not measured yet. */
    get pending() {
      return pending
    },
    /** The listed records measured, in a compute pass of its own, into `buffers`'s edges. */
    encode(encoder: GPUCommandEncoder, buffers: MeasureBuffers) {
      const pipeline = measureKernel(device).get()
      if (!pending || !pipeline) return
      buffer = sizedBuffer(
        device,
        buffer,
        pending * 4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'Trillion3D cluster measure list',
      )
      device.queue.writeBuffer(buffer, 0, listed, 0, pending)
      words[0] = pending
      device.queue.writeBuffer(count, 0, words)
      bindMeasure(device, held, count, pipeline, buffers, buffer)
      const pass = encoder.beginComputePass({ label: CLUSTER_MEASURE_PASS })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, held.group!)
      dispatchRows(pass, pending)
      pass.end()
      pending = 0
    },
    dispose() {
      buffer?.destroy()
      count.destroy()
    },
  }
}
export type ClusterMeasure = ReturnType<typeof createClusterMeasure>
