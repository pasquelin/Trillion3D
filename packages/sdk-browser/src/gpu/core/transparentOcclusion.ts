import { CORNER_VALUES, PARTITION_WORKGROUP } from '../partition/contract.ts';
import { transparentOcclusionShader } from './transparentOcclusionWgsl.ts';
import { shaderFailed } from './shaderModule.ts';
import { bounceGroup, bounceLayout } from '../../bounce/bindings.ts';

export type TransparentOcclusion = NonNullable<
  Awaited<ReturnType<typeof createTransparentOcclusion>>
>;

/** What the test borrows from the rest of the frame: the Hi-Z pyramid it just built,
 *  the uniform the partition wrote for it, and the compact's verdict buffer. */
export type TransparentOcclusionSources = {
  pyramid: () => GPUBuffer | undefined;
  uniforms: GPUBuffer;
  occluded: GPUBuffer;
};

/**
 * Occlusion of transparent clusters, done by the GPU, on the current frame's pyramid.
 *
 * It owns two buffers: the world corners of each transparent-table entry, as two
 * single-precision values, rewritten only when a world matrix changes, and one bit per entry that
 * is never culled (`neverCulled`), which it never rejects. Everything else is
 * borrowed — pyramid, uniform, verdict buffer — so the rule applied to transparent clusters is
 * that of the opaques to the bit, and no frame pays two projections.
 */
export async function createTransparentOcclusion(
  device: GPUDevice,
  entryCount: number,
  sources: TransparentOcclusionSources,
) {
  if (typeof device.createComputePipeline !== 'function' || entryCount < 1) return undefined;
  const corners = device.createBuffer({
    label: 'Trillion3D transparent occlusion corners v1',
    size: entryCount * CORNER_VALUES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const unculledBits = new Uint32Array(Math.ceil(entryCount / 32)),
    unculled = device.createBuffer({
      label: 'Trillion3D transparent occlusion never culled v1',
      size: unculledBits.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  const destroy = () => {
    corners.destroy();
    unculled.destroy();
  };
  let disposed = false;
  try {
    const layout = bounceLayout(device, [
      'read-only-storage',
      'read-only-storage',
      'storage',
      'uniform',
      'read-only-storage',
    ]);
    const module = device.createShaderModule({ code: transparentOcclusionShader(entryCount) });
    if (await shaderFailed(module)) {
      destroy();
      return undefined;
    }
    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'testTransparentClusters' },
    });
    // The pyramid changes identity on every target resize: the bind group follows it, and a
    // frame without a pyramid encodes nothing rather than reading a dead buffer.
    let bound: GPUBuffer | undefined, bindGroup: GPUBindGroup | undefined;
    const bindTo = (pyramid: GPUBuffer) => {
      bound = pyramid;
      bindGroup = bounceGroup(device, layout, [
        corners,
        pyramid,
        sources.occluded,
        sources.uniforms,
        unculled,
      ]);
    };
    const groups = Math.max(1, Math.ceil(entryCount / PARTITION_WORKGROUP));
    const cornerBytes = CORNER_VALUES * 4;
    return {
      /** World corners of entries `[from, to]`, on the only interval the table changed. */
      uploadCorners(packed: Float32Array, from: number, to: number) {
        if (disposed || to < from) return;
        device.queue.writeBuffer(
          corners,
          from * cornerBytes,
          packed.buffer as ArrayBuffer,
          packed.byteOffset + from * cornerBytes,
          (to - from + 1) * cornerBytes,
        );
      },
      /** One bit per entry, set where the entry is never culled: filled by the owner, then sent
       *  whole by `uploadUnculled`. */
      unculledBits,
      uploadUnculled() {
        if (!disposed) device.queue.writeBuffer(unculled, 0, unculledBits);
      },
      /**
       * Writes each entry's verdict for this frame. Without a fresh pyramid there is nothing to
       * walk: the buffer goes back to zero, and the compact keeps all its entries.
       */
      encode(encoder: GPUCommandEncoder, pyramidFresh: boolean) {
        if (disposed) return;
        const pyramid = pyramidFresh ? sources.pyramid() : undefined;
        if (!pyramid) {
          encoder.clearBuffer(sources.occluded, 0, entryCount * 4);
          return;
        }
        if (pyramid !== bound || !bindGroup) bindTo(pyramid);
        const pass = encoder.beginComputePass({ label: 'Trillion3D transparent occlusion' });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup!);
        pass.dispatchWorkgroups(groups);
        pass.end();
      },
      dispose() {
        disposed = true;
        destroy();
      },
    };
  } catch {
    try {
      destroy();
    } catch {
      /* A partial GPU setup must leak nothing. */
    }
    return undefined;
  }
}
