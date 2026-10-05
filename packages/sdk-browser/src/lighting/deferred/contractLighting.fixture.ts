import { createDeferredLighting } from './deferred.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** One pass an encoder began: its descriptor — a compute pass's, its label alone —, the pipeline it
 *  set, its draws (a compute pass's dispatches, their workgroups each). */
interface PassRecord {
  descriptor: GPURenderPassDescriptor;
  pipeline?: GPURenderPipeline | GPUComputePipeline;
  draws: number[];
  ended: boolean;
}

/** A fake device and an encoder that records every pass it begins, with a surface whose
 *  views stay stable, as a real surface keeps: a composition is keyed by the flags view it reads. */
export function gpuHarness() {
  const { device, buffers, writes, destroyed, bindGroups } = fakeDevice();
  const passes: PassRecord[] = [];
  const begin = (descriptor: PassRecord['descriptor']) => {
    const record: PassRecord = { descriptor, draws: [], ended: false };
    passes.push(record);
    return {
      setPipeline(pipeline: PassRecord['pipeline']) {
        record.pipeline = pipeline;
      },
      setBindGroup() {},
      setViewport() {},
      draw(vertices: number) {
        record.draws.push(vertices);
      },
      dispatchWorkgroups(x: number, y = 1) {
        record.draws.push(x * y);
      },
      end() {
        record.ended = true;
      },
    };
  };
  const encoder = {
    beginRenderPass: begin,
    beginComputePass: ({ label }: GPUComputePassDescriptor = {}) =>
      begin({ label, colorAttachments: [] }),
  } as unknown as GPUCommandEncoder;
  const view = () => ({}) as GPUTextureView;
  const surfaceViews = [view(), view(), view(), view()],
    surface = { views: () => surfaceViews } as unknown as SurfaceBuffer;
  return {
    device,
    bindGroups,
    encoder,
    view,
    surface,
    passes,
    /** The label of each pass begun, in order. */
    get labels() {
      return passes.map(({ descriptor }) => descriptor.label);
    },
    /** Each view uniform write, as the floats it sent. */
    get writes() {
      return writes.map((write) => written(write) as Float32Array);
    },
    /** Whether the view uniform, the first buffer made, was destroyed. */
    get destroyed() {
      return destroyed.includes(buffers[0]!);
    },
  };
}

/** A deferred lighting on the harness with its contract program compiled, bound to `target`;
 *  `bind(contract)` rebinds it to the direct contract or to the plain composition. */
export async function contractLighting() {
  const h = gpuHarness();
  const lighting = await createDeferredLighting(h.device);
  const target = h.view();
  const bind = (contract = true) =>
    lighting.bind(h.surface, target, target, contract, { lights: {} as GPUBuffer });
  bind();
  await lighting.settle();
  bind();
  return Object.assign(h, { lighting, target, bind });
}
