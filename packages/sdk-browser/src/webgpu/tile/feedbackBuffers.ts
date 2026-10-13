/** The most tiles one image lists: more than a pool serves in an image, and the readback they make
 *  stays the same whatever the textures the scene wears. A tile past it speaks again at the next
 *  phase — its place stamped all the same (`reduceWgsl.ts`). */
const FEEDBACK_HITS = 16384

/** One generation of buffers: `count` counters and the list its ring takes are copied from. */
export function feedbackBuffers(device: GPUDevice, count: number, generation: number) {
  const capacity = Math.min(count, FEEDBACK_HITS)
  const words = 1 + 2 * capacity
  const bytes = Math.max(16, count * 4),
    listBytes = Math.max(16, words * 4)
  const buffer = (label: string, size: number, usage: number) =>
    device.createBuffer({ label, size, usage })
  return {
    generation,
    count,
    capacity,
    words,
    listBytes,
    buffer: buffer('Trillion3D texture feedback', bytes, GPUBufferUsage.STORAGE),
    list: buffer(
      'Trillion3D texture feedback hits',
      listBytes,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    ),
  }
}
