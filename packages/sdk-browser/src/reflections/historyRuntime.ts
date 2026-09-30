import { invertMatrix4, matrixAtRenderOrigin } from '../../../sdk-core/src/index.ts';
import { createReflectionHistoryTargets, type ReflectionMetadata } from './historyTargets.ts';
import {
  REFLECTION_RESOLVE_VIEW_BYTES,
  REFLECTION_HISTORY_WEIGHT,
  REFLECTION_MOVING_WEIGHT,
} from './resolveWgsl.ts';
import { sameElements } from '../math/matrixElements.ts';
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts';

export interface ReflectionHistoryFrame {
  metadata: ReflectionMetadata;
  pages: GPUBuffer;
  /** The temporal pass's placement motion; read only where `reprojects`. */
  motion: GPUBuffer;
  /** The motion is live this image: a moved source is reprojected, never a reason to reset. */
  reprojects: boolean;
  /** The render origin the motion is written at, where both matrices are anchored. */
  eye: ArrayLike<number>;
  epoch: string;
  seed: number;
  frame: number;
  /** Unjittered camera; jitter must not reopen a completed filter window. */
  camera: ArrayLike<number>;
}

/** Owns only the reflection mean and its metadata; placement data remains shared.
 * A repeated frame with unchanged sources reuses its resolved result, rather than
 * blending it twice against metadata that has already advanced. */
export function createReflectionHistory(device: GPUDevice, width: number, height: number) {
  const targets = createReflectionHistoryTargets(device, width, height);
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
    camera = new Float64Array(16),
    anchored = new Float64Array(16);
  let epoch = '',
    frame = -1,
    written = false,
    rank = 0,
    reuse = false,
    disposed = false;
  let stableFrames = 0;
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
    /** The stationary filter window is complete; a new jitter still needs reprojection. */
    get settled() {
      return stableFrames >= REFLECTION_HISTORY_WEIGHT;
    },
    /** Source epochs cover reflected movers too, not just receiver identity. With live motion a
     *  moved source keeps the history, reprojected, its weight held to `REFLECTION_MOVING_WEIGHT`;
     *  without, it resets it. A new drawn extent always does. */
    prepare(
      next: ReflectionHistoryFrame,
      projection: ArrayLike<number>,
      drawn: readonly number[] = [width, height],
    ) {
      const resized = drawnWidth !== drawn[0] || drawnHeight !== drawn[1];
      const moved = next.epoch !== epoch;
      const changed = resized || (moved && !next.reprojects);
      drawnWidth = drawn[0];
      drawnHeight = drawn[1];
      const cameraChanged = !sameElements(camera, next.camera);
      reuse =
        !changed &&
        !moved &&
        !cameraChanged &&
        written &&
        sameElements(previous, projection) &&
        (stableFrames >= REFLECTION_HISTORY_WEIGHT || frame === next.frame);
      if (reuse) return;
      if (moved || resized || cameraChanged) stableFrames = 0;
      if (changed) {
        written = false;
        rank = 0;
      } else if (written) rank = (rank + 1) >>> 0;
      current = next;
      camera.set(next.camera);
      matrix = projection;
      epoch = next.epoch;
      frame = next.frame;
      packed.set(matrixAtRenderOrigin(anchored, written ? previous : projection, next.eye), 0);
      matrixAtRenderOrigin(anchored, projection, next.eye);
      packed.set(invertMatrix4(anchored, anchored), 16);
      packed[32] = drawnWidth;
      packed[33] = drawnHeight;
      packed[34] = 1 / drawnWidth;
      packed[35] = 1 / drawnHeight;
      packed[36] = written ? 1 : 0;
      packed[37] = moved || cameraChanged ? REFLECTION_MOVING_WEIGHT : REFLECTION_HISTORY_WEIGHT;
      packed[38] = next.reprojects ? 1 : 0;
      // The low bits of the trace's seed (`gpu.ts`): which pixel of each 2 × 2 block it traced.
      packed[39] = (rank ^ next.seed) & 3;
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
