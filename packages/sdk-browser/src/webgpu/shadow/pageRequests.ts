import type { ShadowRequestReport } from '../../../../sdk-core/src/scene/light-shadow/requests.ts';
import type { ShadowPoolSnapshot } from '../../../../sdk-core/src/scene/light-shadow/mirror.ts';
import { SHADOW_REQUEST_BITS } from '../../lighting/direct/shadowRequestWgsl.ts';
import { shadowRequestCap } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createShadowAllocationBuffers, shadowAllocationBytes } from './allocBuffers.ts';

/** Readback slots in flight at most: a frame whose three predecessors are still mapping asks
 *  again the next frame, which reads the same image. */
const SLOTS = 3;
/** Bytes of the request buffer of a pool of `pages` — the count, the list, one bit per table
 *  entry —, and of the buffers its pages are allocated in on the GPU (`allocBuffers.ts`). */
export const shadowRequestBytes = (pages: number) =>
  requestBytes(pages) + shadowAllocationBytes(pages);
const requestBytes = (pages: number) => (1 + shadowRequestCap(pages) + SHADOW_REQUEST_BITS) * 4;

type Slot = {
  buffer: GPUBuffer;
  /** The GPU pool the copy carries, when the GPU allocates. */
  pool: ShadowPoolSnapshot;
  busy: boolean;
  /** The read in progress, once the image that copied it is submitted. */
  reading: Promise<void> | undefined;
  report: ShadowRequestReport;
};

/**
 * THE RETURN PATH OF THE SHADOW REQUESTS: what the opaque resolve recorded, copied after it and
 * read back once the image is submitted, like the texture feedback. The request buffer is zeroed
 * before the resolve of every image that lights — a held image lights nothing and asks for
 * nothing. Each copy carries the frame, the table layout and the plan stamp it was read under, so
 * the scheduler reads it against the right windows and knows whether it proves a settled state.
 * The request buffer is made with the pool, its list as long as `shadowRequestCap` of its `pages`,
 * and so are the buffers the GPU allocates its pages in: while it does, each copy carries the GPU
 * pool after that frame's allocation too, the snapshot the host pool follows (`mirror.ts`).
 */
export function createShadowPageRequests(device: GPUDevice, pages: number) {
  const cap = shadowRequestCap(pages),
    listBytes = (1 + cap) * 4,
    allocation = createShadowAllocationBuffers(device, pages);
  const requestBuffer = device.createBuffer({
    label: 'Trillion3D shadow requests v1',
    size: requestBytes(pages),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const slots: Slot[] = [];
  for (let i = 0; i < SLOTS; i++)
    slots.push({
      buffer: device.createBuffer({
        label: 'Trillion3D shadow request readback',
        size: listBytes + allocation.snapshotBytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      pool: {
        owner: new Int32Array(pages),
        requested: new Int32Array(pages),
        allocated: 0,
        refused: 0,
      },
      busy: false,
      reading: undefined,
      report: {
        frame: -1,
        layoutEpoch: -1,
        stamp: -1,
        count: 0,
        entries: new Uint32Array(cap),
      },
    });
  let inFlight = 0;
  return {
    /** What the shading records its requests in (`../../lighting/direct/shadowRequestWgsl.ts`). */
    buffer: requestBuffer,
    /** The buffers the GPU allocates the pool's pages in (`allocBuffers.ts`). */
    allocation,
    /** GPU bytes of the request buffer and allocation, counted in the pool (`shadowRequestBytes`). */
    bytes: requestBuffer.size + allocation.bytes,
    /** Copies waiting for their image to be read back: an image may not hold before they land. */
    get inFlight() {
      return inFlight;
    },
    /** Resolves once every submitted copy has been read and delivered. */
    async settled() {
      for (const slot of slots) if (slot.reading) await slot.reading;
    },
    /** Zeroes what the resolve will record into. */
    clear(encoder: GPUCommandEncoder) {
      encoder.clearBuffer(requestBuffer);
    },
    /**
     * Copies what the resolve recorded, stamped. Returns the settlement to call once the command
     * buffer is submitted — or dropped —, or nothing when every slot is still being read.
     */
    copy(
      encoder: GPUCommandEncoder,
      frame: number,
      layoutEpoch: number,
      stamp: number,
      deliver: (report: ShadowRequestReport) => void,
      /** The GPU allocates: the copy carries its pool. */
      gpuPool = false,
    ) {
      const slot = slots.find((candidate) => !candidate.busy);
      if (!slot) return undefined;
      slot.busy = true;
      inFlight++;
      slot.report.frame = frame;
      slot.report.layoutEpoch = layoutEpoch;
      slot.report.stamp = stamp;
      encoder.copyBufferToBuffer(requestBuffer, 0, slot.buffer, 0, listBytes);
      if (gpuPool)
        encoder.copyBufferToBuffer(
          allocation.state,
          0,
          slot.buffer,
          listBytes,
          allocation.snapshotBytes,
        );
      slot.report.pool = gpuPool ? slot.pool : undefined;
      return (submitted: boolean) => {
        const done = () => {
          slot.busy = false;
          slot.reading = undefined;
          inFlight--;
        };
        if (!submitted) {
          done();
          return;
        }
        slot.reading = slot.buffer
          .mapAsync(GPUMapMode.READ)
          .then(() => {
            const words = new Uint32Array(slot.buffer.getMappedRange());
            slot.report.count = words[0];
            slot.report.entries.set(words.subarray(1, 1 + Math.min(words[0], cap)));
            if (slot.report.pool) allocation.read(words.subarray(1 + cap), slot.report.pool);
            slot.buffer.unmap();
            deliver(slot.report);
          })
          .catch(() => {})
          .finally(done);
      };
    },
    dispose() {
      requestBuffer.destroy();
      allocation.dispose();
      for (const slot of slots) slot.buffer.destroy();
    },
  };
}

export type ShadowPageRequests = ReturnType<typeof createShadowPageRequests>;
