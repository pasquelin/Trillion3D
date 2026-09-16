import { REST_COMPACT_SHADER, REST_COMPACT_WORKGROUP } from './gpuRestCompactWgsl.ts';
import { MAX_DRAW_SLOTS } from './gpuDraw.ts';
import { dropValidation, openValidation, validationError } from './gpuErrorScope.ts';
import { shaderFailed } from './gpuShaderModule.ts';

/** L'étiquette de la passe, celle que le profil par étape range dans « Géométrie ». */
export const REST_COMPACT_PASS = 'WG rest truncation';

export type GpuRestCompact = {
  /**
   * Ramène le compte d'instances de chaque commande indirecte de la moitié testée au rang de sa
   * dernière ligne survivante. `rows` borne le lancement — une moitié testée ne peut pas tenir plus
   * de lignes que la table n'en a de dessinables. La table de lignes est passée à chaque image :
   * elle est allouée après la création de ce noyau.
   */
  encode(encoder: GPUCommandEncoder, restSlots: number, rows: number, pages: GPUBuffer): void;
  dispose(): void;
};

/**
 * La troncature de la moitié testée. Elle n'existe que si la compaction de dessin et la pyramide
 * existent : sans elles il n'y a ni liste d'instances, ni verdict à lire. Une plateforme sans calcul
 * rend `undefined`, et l'image garde le chemin d'avant — la seconde passe dessine alors les lignes
 * rejetées, dont chaque sommet est écarté un par un, exactement comme auparavant.
 */
export async function createGpuRestCompact(
  device: GPUDevice,
  buffers: {
    instances: GPUBuffer;
    indirect: GPUBuffer;
    slotOffsets: GPUBuffer;
    flags: GPUBuffer;
  },
): Promise<GpuRestCompact | undefined> {
  if (typeof device.createComputePipeline !== 'function') return undefined;
  const owned: GPUBuffer[] = [];
  try {
    const uniforms = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const last = device.createBuffer({
      label: 'WG rest last survivor',
      size: MAX_DRAW_SLOTS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    owned.push(uniforms, last);
    openValidation(device);
    const storage = { type: 'storage' } as const,
      readOnly = { type: 'read-only-storage' } as const;
    const layout = device.createBindGroupLayout({
      entries: [0, 1, 2, 3, 4, 5, 6].map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer:
          binding === 6
            ? ({ type: 'uniform' } as const)
            : binding === 1 || binding === 5
              ? storage
              : readOnly,
      })),
    });
    const module = device.createShaderModule({ code: REST_COMPACT_SHADER });
    if (await shaderFailed(device, module)) {
      for (const buffer of owned) buffer.destroy();
      return undefined;
    }
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const markPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'restMark' },
    });
    const applyPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'restApply' },
    });
    if (await validationError(device)) {
      for (const buffer of owned) buffer.destroy();
      return undefined;
    }
    const uniData = new Uint32Array(4);
    const zeros = new Uint32Array(MAX_DRAW_SLOTS);
    let disposed = false,
      boundPages: GPUBuffer | undefined,
      bindGroup: GPUBindGroup | undefined;
    return {
      encode(encoder, restSlots, rows, pages) {
        if (disposed || restSlots < 1 || rows < 1) return;
        if (!bindGroup || boundPages !== pages) {
          boundPages = pages;
          bindGroup = device.createBindGroup({
            layout,
            entries: [
              buffers.instances,
              buffers.indirect,
              buffers.slotOffsets,
              pages,
              buffers.flags,
              last,
              uniforms,
            ].map((buffer, binding) => ({ binding, resource: { buffer } })),
          });
        }
        uniData[0] = restSlots;
        device.queue.writeBuffer(uniforms, 0, uniData);
        // Aucune image ne lit le rang d'une image antérieure : il repart de zéro avant la marque.
        device.queue.writeBuffer(last, 0, zeros);
        const pass = encoder.beginComputePass({ label: REST_COMPACT_PASS });
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(markPipeline);
        pass.dispatchWorkgroups(Math.ceil(rows / REST_COMPACT_WORKGROUP), restSlots);
        pass.setPipeline(applyPipeline);
        pass.dispatchWorkgroups(1);
        pass.end();
      },
      dispose() {
        disposed = true;
        for (const buffer of owned) buffer.destroy();
      },
    };
  } catch {
    await dropValidation(device);
    for (const buffer of owned)
      try {
        buffer.destroy();
      } catch {
        /* Un montage partiel ne doit rien laisser fuir. */
      }
    return undefined;
  }
}
