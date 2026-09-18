/**
 * La réduction du retour d'image des transparents : la cible où chaque pixel a posé le rang de la
 * tuile qu'il demande devient des compteurs, les mêmes que la résolution opaque incrémente.
 *
 * La passe de mélange ne peut pas écrire en mémoire sans perdre son rejet anticipé de profondeur
 * (`webgpuBlendRejetAnticipe.test.ts`) : elle écrit une cible, et c'est cette passe de calcul, un
 * fil par pixel de la phase, qui compte. Un pixel sur seize hors barrière, tous pendant une
 * convergence — la même phase que la résolution opaque, lue dans le même mot.
 */
const WORKGROUP = 8;

const REDUCE_WGSL = `struct ReduceUni{size:vec2u,feedback:u32,pad:u32,}
@group(0) @binding(0) var requests:texture_2d<u32>;
@group(0) @binding(1) var<storage,read_write> tileFeedback:array<atomic<u32>>;
@group(0) @binding(2) var<uniform> uni:ReduceUni;
@compute @workgroup_size(${WORKGROUP},${WORKGROUP}) fn reduce(@builtin(global_invocation_id) id:vec3u){
 var p=id.xy;
 if((uni.feedback&16u)==0u){p=p*4u+vec2u(uni.feedback&3u,(uni.feedback>>2u)&3u);}
 if(p.x>=uni.size.x||p.y>=uni.size.y){return;}
 let request=textureLoad(requests,p,0).r;
 if(request!=0u){atomicAdd(&tileFeedback[request-1u],1u);}
}`;

export type WebgpuTileReduce = {
  /** Encode la réduction de la cible vers les compteurs, pour la phase de l'image. */
  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    feedback: GPUBuffer,
    size: [number, number],
    phaseWord: number,
  ): void;
  destroy(): void;
};

/** `undefined` sur un appareil sans étage de calcul : les transparents gardent alors leurs queues,
 *  et le diagnostic de préparation le dit. */
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
  // Le groupe suit la cible et le tampon : refait quand l'un des deux change d'identité.
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
      const every = (phaseWord & 16) !== 0;
      const cols = every ? size[0] : Math.ceil(size[0] / 4),
        rows = every ? size[1] : Math.ceil(size[1] / 4);
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
