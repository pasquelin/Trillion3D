import { writeReprojection } from '../taa/view.ts';
import { createReflectionHistoryTargets, type ReflectionPrevious } from './historyTargets.ts';
import {
  REFLECTION_CHANGE_FRAMES,
  REFLECTION_RESOLVE_VIEW_BYTES,
  REFLECTION_HISTORY_WEIGHT,
} from './resolveWgsl.ts';
import {
  historyConfidence,
  REFLECTION_LIGHTING_VERSIONS,
  REFLECTION_PLACEMENT_VERSIONS,
  type ReflectionHistoryFrame,
} from './historyFrame.ts';
import { sameElements, sameValues } from '../math/matrixElements.ts';
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts';

/** Owns only the reflection mean and its metadata; placement data remains shared.
 * A repeated frame with unchanged sources reuses its resolved result, rather than
 * blending it twice against metadata that has already advanced. */
export function createReflectionHistory(
  device: GPUDevice,
  width: number,
  height: number,
  kept: ReflectionPrevious,
) {
  const targets = createReflectionHistoryTargets(device, width, height, kept);
  let uniform: GPUBuffer;
  try {
    uniform = device.createBuffer({
      label: 'Trillion3D reflection resolve view',
      size: REFLECTION_RESOLVE_VIEW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  } catch (error) {
    targets.dispose();
    throw error;
  }
  const packed = new Float32Array(40);
  const previous = new Float64Array(16),
    camera = new Float64Array(16);
  const epoch = new Float64Array(REFLECTION_PLACEMENT_VERSIONS).fill(NaN),
    lighting = new Float64Array(REFLECTION_LIGHTING_VERSIONS).fill(NaN);
  let frame = -1,
    written = false,
    rank = 0,
    reuse = false,
    disposed = false;
  let stableFrames = 0,
    sinceChange = Infinity; // frames resolved since a source changed; none: Infinity
  const complete = () =>
    stableFrames >= REFLECTION_HISTORY_WEIGHT &&
    sinceChange >= REFLECTION_CHANGE_FRAMES + REFLECTION_HISTORY_WEIGHT;
  let drawnWidth = width,
    drawnHeight = height;
  let current: ReflectionHistoryFrame | undefined;
  let matrix: ArrayLike<number> | undefined;
  const bindings = new WeakMap<
    GPUTextureView,
    { identity: WebgpuBindIdentity; group?: GPUBindGroup }
  >();
  return {
    bytes: targets.bytes,
    get image() {
      return targets.image;
    },
    get rank() {
      return rank;
    },
    get reuse() {
      return reuse;
    },
    /** The stationary filter window is complete, and no stale share of a changed source remains;
     *  a new jitter still needs reprojection. */
    get settled() {
      return complete();
    },
    /** Source epochs cover reflected movers too, not just receiver identity. With live motion a
     *  moved source keeps the history, reprojected, its weight held to `REFLECTION_MOVING_WEIGHT`;
     *  without, it keeps it at `REFLECTION_CHANGE_WEIGHT` for `REFLECTION_CHANGE_FRAMES`. A relit
     *  source (lights, materials) and a new drawn extent always reset it: no motion brings an old
     *  lighting to the new one. */
    prepare(
      next: ReflectionHistoryFrame,
      projection: ArrayLike<number>,
      drawn: readonly number[] = [width, height],
    ) {
      const resized = drawnWidth !== drawn[0] || drawnHeight !== drawn[1];
      const moved = !sameValues(epoch, next.epoch);
      const relit = !sameValues(lighting, next.lighting);
      const reprojects = next.motion !== next.pages;
      const changed = resized || moved || relit;
      const resets = resized || relit;
      drawnWidth = drawn[0];
      drawnHeight = drawn[1];
      const cameraChanged = !sameElements(camera, next.camera);
      reuse =
        !changed &&
        !cameraChanged &&
        written &&
        sameElements(previous, projection) &&
        (complete() || frame === next.frame);
      if (reuse) return;
      if (changed || cameraChanged) stableFrames = 0;
      if (resets) {
        written = false;
        rank = 0;
        sinceChange = Infinity;
      } else if (written) {
        rank = (rank + 1) >>> 0;
        // A change the motion cannot follow keeps the history at the change weight (#33).
        if (moved && !reprojects) sinceChange = 0;
      }
      current = next;
      camera.set(next.camera);
      matrix = projection;
      epoch.set(next.epoch);
      lighting.set(next.lighting);
      frame = next.frame;
      writeReprojection(packed, written ? previous : projection, projection, next.eye, drawn);
      packed[36] = written ? 1 : 0;
      packed[37] = historyConfidence(reprojects, sinceChange, moved || cameraChanged);
      packed[38] = reprojects ? 1 : 0;
      // The low bits of the trace's seed, the rank's alone (`gpu.ts`): which pixel of each 2 × 2
      // block it traced; four successive ranks visit all four.
      packed[39] = rank & 3;
      device.queue.writeBuffer(uniform, 0, packed);
    },
    encode(
      encoder: GPUCommandEncoder,
      scratch: GPUTextureView,
      pipeline: GPURenderPipeline,
      layout: GPUBindGroupLayout,
    ) {
      if (reuse) return targets.image;
      if (!current || !matrix) throw new Error('REFLECTION_HISTORY_NOT_PREPARED');
      const { metadata, pages, motion } = current;
      const image = targets.resolve(encoder, metadata, (history, output) => {
        let bound = bindings.get(history);
        if (!bound) bindings.set(history, (bound = { identity: createWebgpuBindIdentity() }));
        const next = bound.identity.next;
        next[0] = layout;
        next[1] = scratch;
        next[2] = metadata.depth;
        next[3] = metadata.normal;
        next[4] = metadata.ids;
        next[5] = pages;
        next[6] = motion;
        if (bound.identity.moved()) {
          const views = [
            scratch,
            history,
            metadata.depth.createView(),
            metadata.normal.createView(),
            metadata.ids.createView(),
            targets.previous.depth,
            targets.previous.normal,
            targets.previous.ids,
          ];
          bound.group = device.createBindGroup({
            layout,
            entries: [
              ...views.map((resource, binding) => ({ binding, resource })),
              { binding: 8, resource: { buffer: uniform } },
              { binding: 9, resource: { buffer: pages } },
              { binding: 10, resource: { buffer: motion } },
            ],
          });
        }
        const pass = encoder.beginRenderPass({
          label: 'Trillion3D reflection history resolve',
          colorAttachments: [
            { view: output, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
          ],
        });
        pass.setViewport(0, 0, drawnWidth, drawnHeight, 0, 1);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bound.group!);
        pass.draw(3);
        pass.end();
      });
      previous.set(matrix);
      written = true;
      stableFrames++;
      sinceChange++;
      return image;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      targets.dispose();
      uniform.destroy();
    },
  };
}
export type ReflectionHistory = ReturnType<typeof createReflectionHistory>;
