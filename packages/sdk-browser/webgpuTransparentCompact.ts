import { TRANSPARENT_COMPACT_SHADER } from './webgpuTransparentShader.ts';
import { TRANSPARENT_GROUP, type TransparentTable } from './webgpuTransparentTable.ts';

const UNIFORM_WORDS = 8;

export type TransparentCompaction = NonNullable<
  Awaited<ReturnType<typeof createTransparentCompaction>>
>;

/** The compute half: the three passes that turn the frame's selection mask into instance lists. */
async function compactPasses(
  device: GPUDevice,
  table: TransparentTable,
  bound: readonly GPUBuffer[],
  uniforms: GPUBuffer,
) {
  if (typeof device.createComputePipeline !== 'function') return undefined;
  const readOnly = [0, 2, 7, 8];
  const layout = device.createBindGroupLayout({
    entries: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer:
        binding === 1
          ? { type: 'uniform' as const }
          : readOnly.includes(binding)
            ? { type: 'read-only-storage' as const }
            : { type: 'storage' as const },
    })),
  });
  const module = device.createShaderModule({ code: TRANSPARENT_COMPACT_SHADER });
  if (typeof module.getCompilationInfo === 'function') {
    const info = await module.getCompilationInfo();
    if (info.messages.some((message) => message.type === 'error')) return undefined;
  }
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipelineOf = (entryPoint: string) =>
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
  const pipelines = [
    'countTransparentGroups',
    'prefixTransparentItems',
    'scatterTransparentGroups',
  ].map(pipelineOf);
  const bindTo = (mask: GPUBuffer) =>
    device.createBindGroup({
      layout,
      entries: [
        bound[0],
        uniforms,
        mask,
        bound[1],
        bound[2],
        bound[3],
        bound[4],
        bound[5],
        bound[6],
      ].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  let boundMask = bound[0],
    bindGroup = bindTo(boundMask);
  const uniData = new Uint32Array(UNIFORM_WORDS);
  const groups = Math.max(1, Math.ceil(table.length / TRANSPARENT_GROUP));
  const items = Math.max(1, table.pagedItems.length);
  return (encoder: GPUCommandEncoder, mask: GPUBuffer, maskOffset: number) => {
    uniData[0] = table.length;
    uniData[1] = groups;
    uniData[2] = table.pagedItems.length;
    uniData[3] = maskOffset;
    uniData[4] = table.maxVertexWords;
    if (mask !== boundMask) bindGroup = bindTo((boundMask = mask));
    device.queue.writeBuffer(uniforms, 0, uniData);
    const pass = encoder.beginComputePass({ label: 'WG transparent compaction' });
    pass.setBindGroup(0, bindGroup);
    for (let step = 0; step < 3; step++) {
      pass.setPipeline(pipelines[step]);
      pass.dispatchWorkgroups(
        step === 1 ? Math.ceil(items / 64) : Math.ceil(groups / (step ? 1 : 64)),
      );
    }
    pass.end();
  };
}

/**
 * What a transparent draw reads, and the GPU compaction that fills it.
 *
 * Three buffers outlive every image: the span of each cluster in the page cache, the compacted
 * instance list, and the indirect command of each item. Nothing here is rebuilt per image — the
 * spans move only when a page enters or leaves the cache, and the instance list is written by the
 * GPU from the selection mask of the frame being drawn. `encode` is absent on a device without
 * compute; the caller then writes the very same instance buffer from its CPU cut.
 */
export async function createTransparentCompaction(device: GPUDevice, table: TransparentTable) {
  if (!table.length) return undefined;
  const buffers: GPUBuffer[] = [];
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const make = (label: string, size: number, usage = storage) => {
    const buffer = device.createBuffer({ label, size: Math.max(8, size), usage });
    buffers.push(buffer);
    return buffer;
  };
  try {
    const items = Math.max(1, table.pagedItems.length);
    const entriesBuf = make('WG transparent entries', table.capacity * 4);
    const itemRangesBuf = make('WG transparent item ranges', items * 8);
    const uniforms = make(
      'WG transparent compaction uniforms',
      UNIFORM_WORDS * 4,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const groupCounts = make('WG transparent group counts', table.groupCount * 4);
    const groupOffsets = make('WG transparent group offsets', table.groupCount * 4);
    const instanceBuffer = make('WG transparent instances', table.capacity * 4);
    const spanBuffer = make('WG transparent cluster spans', table.capacity * 8);
    // Le verdict d'occultation de chaque entrée, écrit par le test Hi-Z des transparents un peu plus
    // tôt dans la même soumission. Zéro avant toute image, et zéro sur une image sans pyramide :
    // rien n'est alors retiré de la table.
    // `COPY_SRC` ne sert qu'à l'audit, qui relit les verdicts ; aucune image ne les copie.
    const occludedBuffer = make(
      'WG transparent occlusion verdicts',
      table.capacity * 4,
      storage | GPUBufferUsage.COPY_SRC,
    );
    const diagnosticBuffer = make('WG transparent cluster identity', table.capacity * 4);
    const indirectBuffer = make(
      'WG transparent indirect',
      items * 16,
      storage | GPUBufferUsage.INDIRECT,
    );
    device.queue.writeBuffer(entriesBuf, 0, table.entries);
    device.queue.writeBuffer(itemRangesBuf, 0, table.itemRanges);
    device.queue.writeBuffer(spanBuffer, 0, table.spans);
    const indirectWords = new Uint32Array(items * 4);
    const encode = await compactPasses(
      device,
      table,
      [
        entriesBuf,
        groupCounts,
        groupOffsets,
        instanceBuffer,
        indirectBuffer,
        itemRangesBuf,
        occludedBuffer,
      ],
      uniforms,
    );
    return {
      instanceBuffer,
      occludedBuffer,
      spanBuffer,
      diagnosticBuffer,
      indirectBuffer,
      encode,
      /** Uploads the spans the last residency change rewrote, and nothing else. */
      uploadSpans(first: number, count: number) {
        device.queue.writeBuffer(spanBuffer, first * 8, table.spans.buffer, first * 8, count * 8);
      },
      /** Writes the instance list and the draw counts a CPU cut chose, in the table's own order. */
      uploadInstances(source: Uint32Array, count: number, perItem: Uint32Array) {
        if (count)
          device.queue.writeBuffer(
            instanceBuffer,
            0,
            source.buffer as ArrayBuffer,
            source.byteOffset,
            count * 4,
          );
        for (let item = 0; item < table.pagedItems.length; item++) {
          indirectWords[item * 4] = table.maxVertexWords;
          indirectWords[item * 4 + 1] = perItem[item] ?? 0;
        }
        device.queue.writeBuffer(indirectBuffer, 0, indirectWords);
      },
      uploadDiagnostic(source: Uint32Array<ArrayBuffer>) {
        device.queue.writeBuffer(diagnosticBuffer, 0, source);
      },
      dispose() {
        for (const buffer of buffers) buffer.destroy();
      },
    };
  } catch {
    for (const buffer of buffers)
      try {
        buffer.destroy();
      } catch {
        /* Partial transparent compaction setup must not leak. */
      }
    return undefined;
  }
}
