// The bench's one way to read the GPU back: its commands encoded uncounted (`quiet`), submitted,
// then the bytes the GPU wrote copied out of a mappable buffer.
import type { BenchGpu } from './device.ts';

/** Encodes `encode`'s commands into `device`'s queue uncounted, then resolves to a copy of the
 *  first `bytes` of `read` (a MAP_READ buffer the commands wrote) once the GPU ran them. */
export async function readBack(
  gpu: Pick<BenchGpu, 'quiet'>,
  device: GPUDevice,
  read: GPUBuffer,
  bytes: number,
  encode: (encoder: GPUCommandEncoder) => void,
) {
  gpu.quiet(() => {
    const encoder = device.createCommandEncoder({ label: 'bench read back' });
    encode(encoder);
    device.queue.submit([encoder.finish()]);
  });
  await read.mapAsync(GPUMapMode.READ, 0, bytes);
  const copy = read.getMappedRange(0, bytes).slice(0);
  read.unmap();
  return copy;
}
