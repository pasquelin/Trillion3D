import { REST_COMPACT_SHADER, REST_COMPACT_WORKGROUP } from './gpuRestCompactWgsl.ts';
import { MAX_DRAW_SLOTS } from './gpuDraw.ts';
import { openValidation, validationError } from './gpuErrorScope.ts';
import { cleanupFailedHiz } from './gpuHizPipelines.ts';
import { bounceGroup, bounceLayout } from './bounceBindings.ts';
import { shaderFailed } from './gpuShaderModule.ts';

/** L'étiquette de la passe, celle que le profil par étape range dans « Géométrie ». */
export const REST_COMPACT_PASS = 'WG rest truncation';
const REST_PASS = { label: REST_COMPACT_PASS } as const;

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
  let owned: GPUBuffer[] = [];
  const bail = () => {
    for (const buffer of owned) buffer.destroy();
    return undefined;
  };
  try {
    const uniforms = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Indexé par le rang du slot testé : la moitié des slots de dessin.
    const last = device.createBuffer({
      label: 'WG rest last survivor',
      size: (MAX_DRAW_SLOTS / 2) * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    owned = [uniforms, last];
    openValidation(device);
    const layout = bounceLayout(device, [
      'read-only-storage',
      'storage',
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'storage',
      'uniform',
    ]);
    const module = device.createShaderModule({ code: REST_COMPACT_SHADER });
    if (await shaderFailed(device, module)) return bail();
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const markPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'restMark' },
    });
    const applyPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'restApply' },
    });
    if (await validationError(device)) return bail();
    const uniData = new Uint32Array(4);
    let disposed = false,
      boundPages: GPUBuffer | undefined,
      boundSlots = 0,
      bindGroup!: GPUBindGroup;
    return {
      encode(encoder, restSlots, rows, pages) {
        if (disposed || restSlots < 1 || rows < 1) return;
        if (boundPages !== pages) {
          boundPages = pages;
          bindGroup = bounceGroup(device, layout, [
            buffers.instances,
            buffers.indirect,
            buffers.slotOffsets,
            pages,
            buffers.flags,
            last,
            uniforms,
          ]);
        }
        // Le nombre de slots testés est fixé par la préparation : l'uniforme n'est écrit qu'à son
        // changement.
        if (boundSlots !== restSlots) {
          boundSlots = restSlots;
          uniData[0] = restSlots;
          device.queue.writeBuffer(uniforms, 0, uniData);
        }
        // Aucune image ne lit le rang d'une image antérieure : il repart de zéro avant la marque.
        encoder.clearBuffer(last, 0, restSlots * 4);
        const pass = encoder.beginComputePass(REST_PASS);
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
    await cleanupFailedHiz(device, owned);
    return undefined;
  }
}
