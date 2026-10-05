// The bench's unit: a fixed copy kernel timed alone on the engine's device, whose duration says how
// fast the GPU runs right now. A frame's cost divided by it compares across days and clock states.
import type { BenchGpu } from './device.ts';
import { readBack } from './readBack.ts';

/** The calibration's work: one display of 4112 × 2294 pixels, 16 bytes read and 16 written each. */
export const CALIBRATION_BYTES = 4112 * 2294 * 16;
/** Copied in two halves, each in buffers of its own: a binding of the whole display (151 MB) passes
 *  the 128 MiB of storage binding every device grants, which the `mobile` profile keeps to. */
const HALF_BYTES = CALIBRATION_BYTES / 2;
const CALIBRATION_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> inputs: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outputs: array<vec4f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i < arrayLength(&inputs)) { outputs[i] = inputs[i] * 1.0001 + vec4f(1.0); }
}`;

/** The calibration on the engine's device, its commands uncounted; throws if the device refuses it. */
export async function createCalibration(gpu: BenchGpu, device: GPUDevice) {
  device.pushErrorScope('validation');
  const made = gpu.quiet(() => {
    const usage = GPUBufferUsage;
    const set = device.createQuerySet({ type: 'timestamp', count: 2 });
    const resolved = device.createBuffer({ size: 16, usage: usage.QUERY_RESOLVE | usage.COPY_SRC });
    const read = device.createBuffer({ size: 16, usage: usage.MAP_READ | usage.COPY_DST });
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: CALIBRATION_WGSL }),
        entryPoint: 'main',
      },
    });
    const halves = [0, 1].map(() => {
      const inputs = device.createBuffer({ size: HALF_BYTES, usage: usage.STORAGE });
      const outputs = device.createBuffer({ size: HALF_BYTES, usage: usage.STORAGE });
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputs } },
          { binding: 1, resource: { buffer: outputs } },
        ],
      });
      return { inputs, outputs, bind };
    });
    return { set, resolved, read, pipeline, halves };
  });
  const refused = await device.popErrorScope();
  if (refused) throw new Error(`BENCH_CALIBRATION: ${refused.message}`);
  const { set, resolved, read, pipeline, halves } = made;
  const workgroups = Math.ceil(HALF_BYTES / 16 / 256);
  return {
    /** One copy of the calibration's bytes, timed alone on an idle queue: ms. */
    async time() {
      await device.queue.onSubmittedWorkDone();
      const stamps = await readBack(gpu, device, read, 16, (encoder) => {
        const pass = encoder.beginComputePass({
          timestampWrites: { querySet: set, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
        });
        pass.setPipeline(pipeline);
        for (const { bind } of halves) {
          pass.setBindGroup(0, bind);
          pass.dispatchWorkgroups(workgroups);
        }
        pass.end();
        encoder.resolveQuerySet(set, 0, 2, resolved, 0);
        encoder.copyBufferToBuffer(resolved, 0, read, 0, 16);
      });
      const [begin, end] = new BigInt64Array(stamps);
      return Number(end - begin) / 1e6;
    },
    destroy() {
      for (const held of [set, resolved, read, ...halves.flatMap((h) => [h.inputs, h.outputs])])
        held.destroy();
    },
  };
}
