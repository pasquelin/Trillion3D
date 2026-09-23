/**
 * Image-feedback reduction: the target where each pixel — opaque by hardware resolve, transparent
 * by the blend pass — posted the rank of the tile it wants becomes per-tile counters. No fragment
 * stage writes memory: the blend pass would lose its early-z reject (`../blend/earlyRejection.test.ts`),
 * and resolve paid six atomic counters per phase pixel — six dependent-read chains and six contended
 * atomics, which the whole pixel group the GPU runs together waited on: the materials pass cost twice
 * the old atlas at 2496×1404 on Emerald (5.6 ms versus 2.8; 2.65 without this feedback). It is this
 * compute pass, one thread per phase pixel, that counts: one pixel in sixteen outside a barrier, all
 * of them during a convergence — the reference's principle, the pixel writes its request and analysis
 * comes after.
 */
import { FEEDBACK_EVERY, FEEDBACK_STRIDE } from './feedback.ts';

const WORKGROUP = 8;
const STRIDE_MASK = FEEDBACK_STRIDE - 1;

const REDUCE_WGSL = `struct ReduceUni{size:vec2u,feedback:u32,pad:u32,}
@group(0) @binding(0) var requests:texture_2d<u32>;
@group(0) @binding(1) var<storage,read_write> tileFeedback:array<atomic<u32>>;
@group(0) @binding(2) var<uniform> uni:ReduceUni;
@compute @workgroup_size(${WORKGROUP},${WORKGROUP}) fn reduce(@builtin(global_invocation_id) id:vec3u){
 var p=id.xy;
 if((uni.feedback&${FEEDBACK_EVERY}u)==0u){p=p*${FEEDBACK_STRIDE}u+vec2u(uni.feedback&${STRIDE_MASK}u,(uni.feedback>>2u)&${STRIDE_MASK}u);}
 if(p.x>=uni.size.x||p.y>=uni.size.y){return;}
 let request=textureLoad(requests,p,0).r;
 if(request!=0u){atomicAdd(&tileFeedback[request-1u],1u);}
}`;

export type WebgpuTileReduce = {
  /** Encodes reduction of the target into the counters, for the image's phase. */
  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    feedback: GPUBuffer,
    size: [number, number],
    phaseWord: number,
  ): void;
  destroy(): void;
};

/** `undefined` on a device without a compute stage: transparents then keep their queues, and the
 *  prepare diagnostic says so. */
export function createWebgpuTileReduce(device: GPUDevice): WebgpuTileReduce | undefined {
  if (typeof device.createComputePipeline !== 'function') return undefined;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: 'WG texture feedback reduce',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: device.createShaderModule({ code: REDUCE_WGSL }), entryPoint: 'reduce' },
  });
  const uniform = device.createBuffer({
    label: 'WG texture feedback reduce uniform',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const words = new Uint32Array(4);
  // The group follows the target and the buffer: rebuilt when either changes identity.
  let group: GPUBindGroup | undefined, groupKey: [GPUTextureView, GPUBuffer] | undefined;
  return {
    encode(encoder, target, feedback, size, phaseWord) {
      if (!groupKey || groupKey[0] !== target || groupKey[1] !== feedback) {
        groupKey = [target, feedback];
        group = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: target },
            { binding: 1, resource: { buffer: feedback } },
            { binding: 2, resource: { buffer: uniform } },
          ],
        });
      }
      words[0] = size[0];
      words[1] = size[1];
      words[2] = phaseWord;
      device.queue.writeBuffer(uniform, 0, words);
      const every = (phaseWord & FEEDBACK_EVERY) !== 0;
      const cols = every ? size[0] : Math.ceil(size[0] / FEEDBACK_STRIDE),
        rows = every ? size[1] : Math.ceil(size[1] / FEEDBACK_STRIDE);
      const pass = encoder.beginComputePass({ label: 'WG texture feedback reduce' });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group!);
      pass.dispatchWorkgroups(Math.ceil(cols / WORKGROUP), Math.ceil(rows / WORKGROUP));
      pass.end();
    },
    destroy() {
      uniform.destroy();
    },
  };
}
