/** Bytes of the first staging buffer: a few batches of face uniforms, volumes and commands. */
const FIRST_STAGING_BYTES = 1 << 16;

type Words = Uint32Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Float32Array<ArrayBuffer>;

/**
 * THE WRITES OF A SHADOW BATCH, IN COMMAND ORDER. A frame draws every shadow page it marks, in as
 * many batches as the per-batch buffers take (`../../webgpu/pages/render/encodeShadowBatches.ts`),
 * each over the same buffers — its face uniforms, its cull volumes and commands, its cut's views.
 * `queue.writeBuffer` lands before the whole command buffer: a second batch's write would replace
 * the first's before either ran. So while `stage` holds an encoder, a write goes to a staging
 * buffer at an offset of its own, and a copy into its target is encoded where the batch's commands
 * follow it. The first batch writes straight, as a single batch always did: its writes land first,
 * and each later batch's copy replaces them in order.
 *
 * A write while staged must come outside any pass: every caller writes before it opens its pass.
 * The staging buffer grows by doubling; one it outgrew is destroyed at the next frame's `stage`,
 * once the frame that copied from it is submitted.
 */
function createBatchWrites(device: GPUDevice) {
  let encoder: GPUCommandEncoder | undefined,
    staging: GPUBuffer | undefined,
    at = 0;
  const retired: GPUBuffer[] = [];
  const room = (bytes: number) => {
    if (staging && at + bytes <= staging.size) return staging;
    if (staging) retired.push(staging);
    const size = Math.max(FIRST_STAGING_BYTES, 2 * (staging?.size ?? 0), at + bytes);
    staging = device.createBuffer({
      label: 'Trillion3D shadow batch staging v1',
      size,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    at = 0;
    return staging;
  };
  return {
    /** From now until `end`, writes land in `into`'s command order. */
    stage(into: GPUCommandEncoder) {
      if (!encoder) for (const old of retired.splice(0)) old.destroy();
      if (!encoder) at = 0;
      encoder = into;
    },
    /** Writes land before the command buffer again. */
    end() {
      encoder = undefined;
    },
    /** `count` words of `data` from word `from`, to `target` at byte `offset`. */
    write(target: GPUBuffer, offset: number, data: Words, from = 0, count = data.length - from) {
      if (!encoder) return device.queue.writeBuffer(target, offset, data, from, count);
      const bytes = count * 4;
      if (!bytes) return;
      const buffer = room(bytes);
      device.queue.writeBuffer(buffer, at, data, from, count);
      encoder.copyBufferToBuffer(buffer, at, target, offset, bytes);
      at += bytes;
    },
  };
}

const writers = new WeakMap<GPUDevice, ReturnType<typeof createBatchWrites>>();

/** The shadow batches' writer of `device`: one per device, shared by every per-batch buffer. */
export function shadowBatchWrites(device: GPUDevice) {
  let writer = writers.get(device);
  if (!writer) writers.set(device, (writer = createBatchWrites(device)));
  return writer;
}
