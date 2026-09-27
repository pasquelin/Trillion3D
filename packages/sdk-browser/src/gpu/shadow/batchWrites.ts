import { SHADOW_BATCH_WRITE_BYTES, SHADOW_STAGING_BYTES } from './batchBudget.ts';

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
 * The staged words gather in a host mirror of the staging buffer, and `end` uploads them with one
 * `writeBuffer`, before the frame's command buffer is submitted: every copy still reads its own
 * write's words, and a frame of many batches pays one native call, not one per write (#344).
 *
 * A write while staged must come outside any pass: every caller writes before it opens its pass.
 * The staging buffer and its mirror are made at the first staged write, at the capacity the frame
 * reserved: every batch the current pool may draw but the first, each at most
 * `SHADOW_BATCH_WRITE_BYTES` (`shadowBatchCapacity`, `batchBudget.ts`). A frame that reserves more
 * — a larger pool, fewer views a batch after a light cut dropped work — drops them, made again at
 * its first staged write at the grant (`SHADOW_STAGING_BYTES`), which the memory budget counts: they
 * grow once at most; a batch that writes past what was reserved is a defect, refused by name.
 */
function createBatchWrites(device: GPUDevice) {
  let encoder: GPUCommandEncoder | undefined,
    staging: { buffer: GPUBuffer; words: Uint32Array<ArrayBuffer> } | undefined,
    at = 0,
    batchStart = 0,
    reserved = 0,
    /** The size staging is made at: what the frame reserved, or the grant once it grew. */
    floor = 0;
  const room = (bytes: number) => {
    if (at + bytes - batchStart > SHADOW_BATCH_WRITE_BYTES || at + bytes > reserved)
      throw new Error(`SHADOW_BATCH_WRITES_OVERFLOW: ${bytes} bytes at ${at}`);
    return (staging ??= {
      buffer: device.createBuffer({
        label: 'Trillion3D shadow batch staging v1',
        size: Math.max(floor, reserved),
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      }),
      words: new Uint32Array(Math.max(floor, reserved) / 4),
    });
  };
  return {
    /** Before a frame's batches: they stage at most `bytes` (`shadowBatchCapacity`). A staging
     *  buffer too small for them is dropped, made again at the grant at their first staged write. */
    reserve(bytes: number) {
      reserved = bytes;
      if (staging && staging.words.byteLength < bytes) {
        staging.buffer.destroy();
        staging = undefined;
        floor = SHADOW_STAGING_BYTES;
      }
    },
    /** From now until `end`, writes land in `into`'s command order: one batch's writes. */
    stage(into: GPUCommandEncoder) {
      batchStart = at;
      encoder = into;
    },
    /** Uploads the frame's staged words at once; writes land before the command buffer again. */
    end() {
      if (staging && at) device.queue.writeBuffer(staging.buffer, 0, staging.words, 0, at / 4);
      at = 0;
      encoder = undefined;
    },
    /** `count` words of `data` from word `from`, to `target` at byte `offset`. */
    write(target: GPUBuffer, offset: number, data: Words, from = 0, count = data.length - from) {
      if (!encoder) return device.queue.writeBuffer(target, offset, data, from, count);
      const bytes = count * 4;
      if (!bytes) return;
      const { buffer, words } = room(bytes);
      words.set(new Uint32Array(data.buffer, data.byteOffset + from * 4, count), at / 4);
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
