/**
 * The ring of staging buffers a counter or a status word comes back through a few frames late:
 * a frame `take`s one, copies into it, and once its encoder is submitted (`submitted`) the buffer
 * maps, `read` sees its range in place (no copy of it), and it is free again. No frame waits: when
 * every buffer is in flight, `take` gives none and that frame samples nothing.
 */

interface Staging {
  buffer: GPUBuffer;
  /** The mapping's callbacks, made once with the buffer: a frame allocates no closure. */
  mapped(): void;
  failed(): void;
}

export interface VsmReadbackRing {
  /** A buffer to copy this frame's `bytes` into, none while all are in flight. A copy whose
   *  encoder was never submitted is still pending: this frame's copy takes its place. */
  take(): GPUBuffer | undefined;
  /** After `queue.submit` of the encoder the copy was recorded in: the taken buffer maps. */
  submitted(): void;
  destroy(): void;
}

/**
 * A ring of at most `count` buffers of `bytes` bytes under `label`, made when first taken (all
 * at once with `eager`). `read(mapped, staging)` runs when a buffer maps, over the mapped range
 * valid for that call alone.
 */
export function createVsmReadbackRing(
  device: GPUDevice,
  options: { label: string; bytes: number; count: number; eager?: boolean },
  read: (mapped: ArrayBuffer, staging: GPUBuffer) => void,
): VsmReadbackRing {
  const free: Staging[] = [],
    pending: Staging[] = [],
    all: Staging[] = [];
  let destroyed = false;
  const make = () => {
    const buffer = device.createBuffer({
      label: options.label,
      size: options.bytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const staging: Staging = {
      buffer,
      mapped() {
        if (destroyed) return;
        try {
          read(buffer.getMappedRange(), buffer);
        } finally {
          buffer.unmap();
          free.push(staging);
        }
      },
      failed: () => void (destroyed || free.push(staging)),
    };
    all.push(staging);
    return staging;
  };
  if (options.eager) for (let k = 0; k < options.count; k++) free.push(make());
  return {
    take() {
      if (pending.length > 0) return pending[pending.length - 1].buffer;
      const staging = free.pop() ?? (all.length < options.count ? make() : undefined);
      if (!staging) return undefined;
      pending.push(staging);
      return staging.buffer;
    },
    submitted() {
      for (let k = 0; k < pending.length; k++) {
        const staging = pending[k];
        staging.buffer.mapAsync(GPUMapMode.READ).then(staging.mapped, staging.failed);
      }
      pending.length = 0;
    },
    destroy() {
      destroyed = true;
      for (const staging of all) staging.buffer.destroy();
      all.length = free.length = pending.length = 0;
    },
  };
}
