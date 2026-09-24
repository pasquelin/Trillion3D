import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import type { ShadowRequestReport } from '../../../../sdk-core/src/scene/light-shadow/requests.ts';

/** Readback slots in flight at most: a frame whose three predecessors are still mapping asks
 *  again the next frame, which reads the same image. */
const SLOTS = 3;
const LIST_BYTES = (1 + LIGHT_SETTINGS.shadowRequestCap) * 4;

type Slot = {
  buffer: GPUBuffer;
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
 */
export function createShadowPageRequests(device: GPUDevice, requestBuffer: GPUBuffer) {
  const slots: Slot[] = [];
  for (let i = 0; i < SLOTS; i++)
    slots.push({
      buffer: device.createBuffer({
        label: 'Trillion3D shadow request readback',
        size: LIST_BYTES,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      busy: false,
      reading: undefined,
      report: {
        frame: -1,
        layoutEpoch: -1,
        stamp: -1,
        count: 0,
        entries: new Uint32Array(LIGHT_SETTINGS.shadowRequestCap),
      },
    });
  let inFlight = 0;
  return {
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
    ) {
      const slot = slots.find((candidate) => !candidate.busy);
      if (!slot) return undefined;
      slot.busy = true;
      inFlight++;
      slot.report.frame = frame;
      slot.report.layoutEpoch = layoutEpoch;
      slot.report.stamp = stamp;
      encoder.copyBufferToBuffer(requestBuffer, 0, slot.buffer, 0, LIST_BYTES);
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
            slot.report.entries.set(
              words.subarray(1, 1 + Math.min(words[0], LIGHT_SETTINGS.shadowRequestCap)),
            );
            slot.buffer.unmap();
            deliver(slot.report);
          })
          .catch(() => {})
          .finally(done);
      };
    },
    dispose() {
      for (const slot of slots) slot.buffer.destroy();
    },
  };
}

export type ShadowPageRequests = ReturnType<typeof createShadowPageRequests>;
