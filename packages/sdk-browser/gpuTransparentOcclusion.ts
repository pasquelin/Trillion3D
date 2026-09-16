import { CORNER_VALUES, PARTITION_WORKGROUP } from './gpuPartitionContract.ts';
import { transparentOcclusionShader } from './gpuTransparentOcclusionWgsl.ts';
import { shaderFailed } from './gpuShaderModule.ts';

export type TransparentOcclusion = NonNullable<
  Awaited<ReturnType<typeof createTransparentOcclusion>>
>;

/** Ce que le test emprunte au reste de l'image : la pyramide Hi-Z qu'elle vient de construire,
 *  l'uniforme que la partition a écrit pour elle, et le tampon de verdicts de la compaction. */
export type TransparentOcclusionSources = {
  pyramid: () => GPUBuffer | undefined;
  uniforms: GPUBuffer;
  occluded: GPUBuffer;
};

/**
 * L'occultation des grappes transparentes, faite par la carte, sur la pyramide de l'image courante.
 *
 * Elle ne possède qu'un tampon : les coins monde de chaque entrée de la table transparente, en deux
 * simples précisions, réécrits seulement quand une matrice monde change. Tout le reste est emprunté
 * — la pyramide, l'uniforme, le tampon de verdicts —, si bien que la règle appliquée aux grappes
 * transparentes est celle des opaques au bit près, et qu'aucune image ne paie deux projections.
 */
export async function createTransparentOcclusion(
  device: GPUDevice,
  entryCount: number,
  sources: TransparentOcclusionSources,
) {
  if (typeof device.createComputePipeline !== 'function' || entryCount < 1) return undefined;
  const corners = device.createBuffer({
    label: 'WG transparent occlusion corners v1',
    size: entryCount * CORNER_VALUES * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let disposed = false;
  try {
    const layout = device.createBindGroupLayout({
      entries: (
        ['read-only-storage', 'read-only-storage', 'storage', 'uniform'] as GPUBufferBindingType[]
      ).map((type, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type },
      })),
    });
    const module = device.createShaderModule({ code: transparentOcclusionShader(entryCount) });
    if (await shaderFailed(device, module)) {
      corners.destroy();
      return undefined;
    }
    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'testTransparentClusters' },
    });
    // La pyramide change d'identité à chaque redimensionnement de la cible : le groupe de liaison la
    // suit, et une image sans pyramide n'encode rien plutôt que de lire un tampon mort.
    let bound: GPUBuffer | undefined, bindGroup: GPUBindGroup | undefined;
    const bindTo = (pyramid: GPUBuffer) => {
      bound = pyramid;
      bindGroup = device.createBindGroup({
        layout,
        entries: [corners, pyramid, sources.occluded, sources.uniforms].map((buffer, binding) => ({
          binding,
          resource: { buffer },
        })),
      });
    };
    const groups = Math.max(1, Math.ceil(entryCount / PARTITION_WORKGROUP));
    const cornerBytes = CORNER_VALUES * 4;
    return {
      /** Les coins monde des entrées `[from, to]`, sur le seul intervalle que la table a changé. */
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
      /**
       * Écrit le verdict de chaque entrée pour cette image. Sans pyramide fraîche il n'y a rien à
       * dépouiller : le tampon repart à zéro, et la compaction garde toutes ses entrées.
       */
      encode(encoder: GPUCommandEncoder, pyramidFresh: boolean) {
        if (disposed) return false;
        const pyramid = pyramidFresh ? sources.pyramid() : undefined;
        if (!pyramid) {
          encoder.clearBuffer(sources.occluded, 0, entryCount * 4);
          return false;
        }
        if (pyramid !== bound || !bindGroup) bindTo(pyramid);
        const pass = encoder.beginComputePass({ label: 'WG transparent occlusion' });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup!);
        pass.dispatchWorkgroups(groups);
        pass.end();
        return true;
      },
      dispose() {
        disposed = true;
        corners.destroy();
      },
    };
  } catch {
    try {
      corners.destroy();
    } catch {
      /* Un montage GPU partiel ne doit rien laisser fuir. */
    }
    return undefined;
  }
}
