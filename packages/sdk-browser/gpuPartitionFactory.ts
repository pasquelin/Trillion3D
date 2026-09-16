import {
  CORNER_VALUES,
  PARTITION_WORKGROUP,
  ROW_DATA_U32,
  STATE_WORDS,
} from './gpuPartitionContract.ts';
import { createGpuPartitionBuffers, createGpuPartitionLayout } from './gpuPartitionBuffers.ts';
import { createPartitionUniformWriter, type PartitionFrame } from './gpuPartitionUniform.ts';
import { createPartitionCounters } from './gpuPartitionCounters.ts';
import { PARTITION_SHADER } from './gpuPartitionShader.ts';
import { dropValidation, openValidation, validationError } from './gpuErrorScope.ts';
import { shaderFailed } from './gpuShaderModule.ts';
import type { GpuPartition, KeptFrame, PartitionSources } from './gpuPartitionTypes.ts';

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
    // Ce que la dernière image a envoyé au noyau, gardé pour l'audit : les matrices sont recopiées
    // parce que celles de la caméra sont réécrites par l'image suivante.
    let lastFrame: KeptFrame | undefined;
    const counters = createPartitionCounters(device);
    const cornerBytes = CORNER_VALUES * 4;
    return {
      get lastFrame() {
        return lastFrame;
      },
      async readRowData(wanted: number) {
        const count = Math.min(wanted, allocated.rows);
        if (disposed || count < 1 || typeof device.createBuffer !== 'function') return undefined;
        const bytes = count * ROW_DATA_U32 * 4;
        const staging = device.createBuffer({
          label: 'WG partition rows readback',
          size: bytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        try {
          const encoder = device.createCommandEncoder({ label: 'WG partition rows readback' });
          encoder.copyBufferToBuffer(allocated.rowData, 0, staging, 0, bytes);
          device.queue.submit([encoder.finish()]);
          await staging.mapAsync(GPUMapMode.READ);
          const copy = new Uint32Array(staging.getMappedRange().slice(0));
          staging.unmap();
          return copy;
        } finally {
          staging.destroy();
        }
      },
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
        lastFrame = {
          rows,
          width: frame.width,
          height: frame.height,
          near: frame.near,
          view: Float64Array.from(frame.view as ArrayLike<number>),
          viewProj: Float64Array.from(frame.viewProj as ArrayLike<number>),
        };
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
