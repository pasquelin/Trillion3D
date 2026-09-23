import { readbackBytesPerRow } from './presentation.ts';
/**
 * The two readbacks the proof tools do, and that no frame does.
 *
 * Neither is a render pass: they allocate their staging buffer, submit their own copy, wait for
 * the mapping and return the buffer. An engine that renders frames never calls them — only a host
 * that wants to check what the GPU wrote calls them.
 */

/** Copies `bytes` bytes of a GPU buffer, or `undefined` if the device does not map. */
export async function readGpuBuffer(
  device: GPUDevice,
  source: GPUBuffer,
  bytes: number,
): Promise<Uint32Array | undefined> {
  if (bytes < 4 || typeof device.createBuffer !== 'function') return undefined;
  const staging = device.createBuffer({
    label: 'WG buffer readback',
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder({ label: 'WG buffer readback' });
    encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const copy = new Uint32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    return copy;
  } finally {
    staging.destroy();
  }
}

/**
 * Copies an `r32float` target as one float per texel, rows packed.
 *
 * A texture copy aligns each row to two hundred and fifty-six bytes: the requested width is
 * almost never the buffer's, so the rows are glued back here.
 */
export async function readGpuTextureR32F(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Float32Array | undefined> {
  if (width < 1 || height < 1 || typeof device.createBuffer !== 'function') return undefined;
  const bytesPerRow = readbackBytesPerRow(width);
  const staging = device.createBuffer({
    label: 'WG r32float readback',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder({ label: 'WG r32float readback' });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: staging, bytesPerRow, rowsPerImage: height },
      [width, height, 1],
    );
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const padded = new Float32Array(staging.getMappedRange());
    const out = new Float32Array(width * height),
      stride = bytesPerRow / 4;
    for (let y = 0; y < height; y++)
      out.set(padded.subarray(y * stride, y * stride + width), y * width);
    staging.unmap();
    return out;
  } finally {
    staging.destroy();
  }
}
