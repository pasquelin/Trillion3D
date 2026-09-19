import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import {
  PROXY_COUNTING_OFFSET,
  PROXY_COUNTS,
  PROXY_COUNT_OFFSET,
  PROXY_PARAM_FLOATS,
} from './bounceNodeWgsl.ts';
import type { GpuBounceProxy } from './gpuBounceProxy.ts';
import { createGpuPeriodicReadback } from './gpuPeriodicReadback.ts';

/** The two sampled counters, in bytes: the copy size as well as the mapping size. */
const COUNT_BYTES = PROXY_COUNTS * 4;
/** Ranks of the four settings in the header, in the order the shader reads them. */
const OFFSET = 0,
  START = 1,
  MAX_DISTANCE = 2,
  PRESENT = 3;

/** What the last sampled frame counted, and that frame's number. */
export interface SunFarCounts {
  frame: number;
  tested: number;
  blocked: number;
}

export type GpuSunFarShadow = ReturnType<typeof createGpuSunFarShadow>;

/**
 * Settings and counters of the sun's far shadow, written in the **resident proxy header**: the
 * same buffer the two lighting passes bind to walk it. Columns are never copied; the header
 * only says there is a proxy, how much to lift a ray origin, and how far to push it.
 *
 * Without an adopted proxy there is nothing to write: the passes bind the deferred-resolve
 * replacement, a zero header where presence is zero, and the far surface stays lit without a
 * cast shadow exactly as before this ray existed.
 *
 * Counting is a diagnostic, so it stays outside the measured pass: the sample flag goes to one
 * only one frame in fifteen, and falls back to zero on the next, so the other fourteen execute
 * no `atomicAdd`. The sample itself is an eight-byte copy and a promise, never a wait in the
 * frame.
 */
export function createGpuSunFarShadow(device: GPUDevice) {
  const params = new Float32Array(PROXY_PARAM_FLOATS);
  const countingFlag = new Uint32Array(1);
  const counted: SunFarCounts = { frame: -1, tested: 0, blocked: 0 };
  const reader = createGpuPeriodicReadback((mapped) => {
    const values = new Uint32Array(mapped);
    counted.tested = values[0];
    counted.blocked = values[1];
  });
  reader.adopt(
    device.createBuffer({
      label: 'WG sun far shadow counts readback',
      size: COUNT_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  );
  let proxy: GpuBounceProxy | undefined,
    owned = false,
    counting = false,
    copyOwed = false;

  const setCounting = (value: boolean) => {
    if (counting === value || !proxy) return;
    counting = value;
    countingFlag[0] = value ? 1 : 0;
    device.queue.writeBuffer(proxy.buffer, PROXY_COUNTING_OFFSET, countingFlag);
  };

  return {
    /**
     * Buffer to bind, or nothing until a proxy is resident. It is the proxy's own, returned
     * as-is: the two passes compare the resource given to them to the one they bound, so a new
     * buffer every frame would make them rebuild their group for nothing.
     */
    buffer(): GPUBuffer | undefined {
      return proxy?.buffer;
    },
    get proxy() {
      return proxy;
    },
    /** Offset of a ray origin, in metres: published in the diagnostic as used. */
    get offsetMetres() {
      return params[OFFSET];
    },
    /** Ray start along its direction, in metres: one cell of the loaded proxy. */
    get startMetres() {
      return params[START];
    },
    get maxDistanceMetres() {
      return params[MAX_DISTANCE];
    },
    /**
     * Adopts a resident proxy. `owns` says whether this module loaded it for itself: the bounce
     * light's is borrowed, never copied nor released here. The ray start follows the cell the
     * cache actually obtained, not a constant: a coarser proxy starts farther.
     */
    adopt(resident: GpuBounceProxy, owns: boolean) {
      proxy = resident;
      owned = owns;
      const [x0, y0, z0, x1, y1, z1] = resident.bounds;
      params[OFFSET] = LIGHT_SETTINGS.sunFarShadowOffsetMetres;
      params[START] = resident.cellMetres * LIGHT_SETTINGS.sunFarShadowStartCells;
      // Range of a shadow ray: the diagonal of the proxy extent. Beyond, there is nothing left
      // to cut, and a sun is far enough that every occluder fits inside.
      params[MAX_DISTANCE] = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      params[PRESENT] = resident.nodeCount > 0 ? 1 : 0;
      device.queue.writeBuffer(resident.buffer, 0, params);
      // The new header carries a sample flag of zero: that is also the state this module holds.
      counting = false;
    },
    /**
     * What the frame must encode before its lighting pass: the previous frame's sample, then,
     * one frame in fifteen, clearing the counters and raising the flag.
     */
    prepare(encoder: GPUCommandEncoder, frame: number) {
      if (!proxy) return;
      if (copyOwed) {
        reader.copy(encoder, proxy.buffer, PROXY_COUNT_OFFSET, COUNT_BYTES);
        copyOwed = false;
      }
      // A proxy without a node leaves this flag at zero: there is then neither a fired ray nor anything to count.
      const sample = params[PRESENT] > 0 && reader.due(frame);
      setCounting(sample);
      if (!sample) return;
      encoder.clearBuffer(proxy.buffer, PROXY_COUNT_OFFSET, COUNT_BYTES);
      copyOwed = true;
      counted.frame = frame;
      reader.sampled(frame);
    },
    /** Requests mapping of the sample, once the frame that copied it is submitted. */
    submitted: reader.submitted,
    /** Counters of the last sampled frame, or nothing until one has come back. */
    counts(): SunFarCounts | undefined {
      return reader.ready ? counted : undefined;
    },
    dispose() {
      reader.dispose();
      if (owned) proxy?.dispose();
      proxy = undefined;
    },
  };
}
