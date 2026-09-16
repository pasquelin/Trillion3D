import { CORNER_VALUES, PARTITION_WORKGROUP, STATE_WORDS } from './gpuPartitionContract.ts';
import { createGpuPartitionBuffers, createGpuPartitionLayout } from './gpuPartitionBuffers.ts';
import { createPartitionUniformWriter, type PartitionFrame } from './gpuPartitionUniform.ts';
import { createPartitionCounters } from './gpuPartitionCounters.ts';
import { PARTITION_SHADER } from './gpuPartitionShader.ts';
import { dropValidation, openValidation, validationError } from './gpuErrorScope.ts';
import { shaderFailed } from './gpuShaderModule.ts';
import type { GpuPartition, PartitionSources } from './gpuPartitionTypes.ts';

/**
 * La partition d'une image, faite par la carte : projection des boîtes, partage occulteurs/testés,
 * empaquetage des bornes du test Hi-Z. Une compilation en échec rend `undefined`, et l'appelant
 * garde alors sa coupe sans occultation plutôt que de tomber en silence.
 */
export async function createGpuPartition(
  device: GPUDevice,
  slotCap: number,
  sources: PartitionSources,
): Promise<GpuPartition | undefined> {
  if (typeof device.createComputePipeline !== 'function' || slotCap < 1) return undefined;
  const allocated = createGpuPartitionBuffers(device, slotCap);
  let disposed = false;
  try {
    openValidation(device);
    const layout = createGpuPartitionLayout(device);
    const module = device.createShaderModule({ code: PARTITION_SHADER });
    if (await shaderFailed(device, module)) {
      for (const buffer of allocated.all) buffer.destroy();
      return undefined;
    }
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipelineFor = (entryPoint: string) =>
      device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
    const project = pipelineFor('projectRows'),
      choose = pipelineFor('chooseSplit'),
      classify = pipelineFor('classifyRows');
    const bindGroup = device.createBindGroup({
      layout,
      entries: [
        allocated.corners,
        sources.items,
        sources.flags,
        allocated.rowData,
        allocated.tested,
        sources.restBits,
        sources.slotUsed,
        allocated.state,
        allocated.uniforms,
      ].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    if (await validationError(device)) {
      for (const buffer of allocated.all) buffer.destroy();
      return undefined;
    }
    const writeUniform = createPartitionUniformWriter();
    const counters = createPartitionCounters(device);
    const cornerBytes = CORNER_VALUES * 4;
    return {
      corners: allocated.corners,
      tested: allocated.tested,
      state: allocated.state,
      rowData: allocated.rowData,
      /** Les coins monde des lignes `[from, to]`, sur l'intervalle sale de la table et lui seul. */
      uploadCorners(packed: Float32Array, from: number, to: number) {
        if (disposed || to < from) return;
        device.queue.writeBuffer(
          allocated.corners,
          from * cornerBytes,
          packed.buffer as ArrayBuffer,
          packed.byteOffset + from * cornerBytes,
          (to - from + 1) * cornerBytes,
        );
      },
      encode(encoder: GPUCommandEncoder, frame: PartitionFrame) {
        if (disposed) return;
        const rows = Math.min(frame.rows, allocated.rows);
        // Rien n'est tenu d'une image à l'autre que l'historique, qui vit dans `rowData` : les
        // compteurs, l'histogramme, les bits de reste et les comptes par slot repartent de zéro.
        encoder.clearBuffer(allocated.state, 0, STATE_WORDS * 4);
        encoder.clearBuffer(sources.restBits);
        encoder.clearBuffer(sources.slotUsed);
        writeUniform(device, allocated.uniforms, { ...frame, rows });
        const groups = Math.max(1, Math.ceil(rows / PARTITION_WORKGROUP));
        const pass = encoder.beginComputePass({ label: 'WG partition' });
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(project);
        pass.dispatchWorkgroups(groups);
        pass.setPipeline(choose);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(classify);
        pass.dispatchWorkgroups(groups);
        pass.end();
      },
      encodeCounts(encoder: GPUCommandEncoder, frame: number) {
        if (!disposed) counters.encodeCopy(encoder, allocated.state, frame);
      },
      countsDue: (frame: number) => !disposed && counters.due(frame),
      countsSubmitted: counters.submitted,
      counts: counters.counts,
      dispose() {
        disposed = true;
        counters.dispose();
        for (const buffer of allocated.all) buffer.destroy();
      },
    };
  } catch {
    await dropValidation(device);
    for (const buffer of allocated.all)
      try {
        buffer.destroy();
      } catch {
        /* Un montage GPU partiel ne doit rien laisser fuir. */
      }
    return undefined;
  }
}
