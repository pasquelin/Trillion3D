/**
 * Virtual-texture image feedback: what the pixels ASKED for, tile by tile.
 *
 * Each pixel posts in the feedback target the rank of the tile it wants, and a compute pass
 * (`webgpuTileReduce.ts`) counts one in sixteen. At the end of the image, the counters are copied
 * into a readback buffer and zeroed; the read is asynchronous and comes back one image later, never
 * blocking the current image. Two readback buffers take turns: one maps while the other receives the
 * next copy.
 *
 * The phase advances from one image to the next so the sixteen pixels of a square have all spoken in
 * sixteen images; a barrier that must converge asks for every pixel at once.
 */
/** Phase word: the `FEEDBACK_EVERY` bit asks for every pixel; otherwise the two low bits give the
 *  column and the next two the row of the speaking pixel in each `FEEDBACK_STRIDE` square, therefore
 *  `FEEDBACK_EVERY` phases before the whole square has been heard. */
export const FEEDBACK_STRIDE = 4;
export const FEEDBACK_EVERY = FEEDBACK_STRIDE * FEEDBACK_STRIDE;

export type WebgpuTileFeedback = {
  readonly buffer: GPUBuffer;
  readonly entries: number;
  /** Word the uniform carries: the phase, or "every pixel" during a convergence. */
  phaseWord(every: boolean): number;
  /** Copies the counters to a free readback buffer and zeroes them, in the image. */
  encode(encoder: GPUCommandEncoder): void;
  /** The image is submitted: the copy it carried maps; the phase advances. */
  submitted(): void;
  /** The last counters that came back, once; `undefined` until one has come back. */
  take(): Uint32Array | undefined;
  /** Held when every in-flight read has come back. */
  settled(): Promise<void>;
  destroy(): void;
};

type Device = Pick<GPUDevice, 'createBuffer'>;

export function createWebgpuTileFeedback(device: Device, entries: number): WebgpuTileFeedback {
  const bytes = Math.max(16, entries * 4);
  const buffer = device.createBuffer({
    label: 'WG texture feedback',
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const staging = [0, 1].map((rank) =>
    device.createBuffer({
      label: `WG texture feedback readback ${rank}`,
      size: bytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }),
  );
  // Per readback buffer: a copy encoded but not submitted, or an in-flight mapping.
  const copied = [false, false],
    busy = [false, false];
  const inFlight = new Set<Promise<void>>();
  // Counters that came back, one array per readback buffer: nothing is allocated per image.
  const held = [0, 1].map(() => new Uint32Array(entries));
  let next = 0,
    phase = 0,
    latest: Uint32Array | undefined;
  return {
    buffer,
    entries,
    phaseWord: (every) => (every ? FEEDBACK_EVERY : 0) | phase,
    encode(encoder) {
      if (busy[next] || copied[next]) return;
      encoder.copyBufferToBuffer(buffer, 0, staging[next], 0, bytes);
      encoder.clearBuffer(buffer);
      copied[next] = true;
    },
    submitted() {
      phase = (phase + 1) % FEEDBACK_EVERY;
      if (!copied[next]) return;
      const rank = next;
      copied[rank] = false;
      busy[rank] = true;
      const target = staging[rank];
      const read = target
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          held[rank].set(new Uint32Array(target.getMappedRange(), 0, entries));
          target.unmap();
          latest = held[rank];
        })
        .catch(() => undefined)
        .finally(() => {
          busy[rank] = false;
          inFlight.delete(read);
        });
      inFlight.add(read);
      next ^= 1;
    },
    take() {
      const counts = latest;
      latest = undefined;
      return counts;
    },
    settled: () => Promise.all(inFlight).then(() => undefined),
    destroy() {
      buffer.destroy();
      for (const target of staging) target.destroy();
    },
  };
}
