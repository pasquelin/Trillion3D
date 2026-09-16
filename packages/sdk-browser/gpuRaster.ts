import {
  DISPATCH_SPAN,
  DISPATCH_WORDS,
  HEADER_CLEAR_BYTES,
  LIST_HEADER,
  MODE_DEPTH_OCCLUDER,
  MODE_DEPTH_REST,
  MODE_ID,
  RASTER_CLASSES,
  rasterEntry,
} from './gpuRasterContract.ts';
import { RESOLVE, rasterSource } from './gpuRasterShader.ts';
import { SMALL_BINDINGS, atlasLayoutEntry, readOnly } from './webgpuBindLayout.ts';
import { smallBindEntries } from './webgpuBindEntries.ts';
import { createRasterResolves } from './gpuRasterResolve.ts';
import type { GpuRasterInput } from './gpuRasterTypes.ts';

/**
 * Le raster de calcul de la coupe opaque et masquée.
 *
 * `capacity` est le nombre de triangles qu'une liste peut tenir : tout triangle de toute ligne
 * dessinable. Les deux listes en tiennent donc chacune la totalité, et aucune image n'en perd un.
 */
export function createGpuRaster(
  device: GPUDevice,
  width: number,
  height: number,
  capacity: number,
) {
  // Un seul tampon de stockage pour l'image et pour les listes : l'étage de calcul n'a droit qu'à
  // huit tampons sur l'appareil le plus pauvre que WebGPU garantit, et le raster les emploie tous.
  const targetBytes = Math.max(8, width * height * 8),
    listOffset = targetBytes;
  const work = device.createBuffer({
    label: 'WG raster target and lists',
    size: listOffset + Math.max(4, (LIST_HEADER + 2 * capacity) * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  // Les mots de lancement sont copiés hors des listes au lieu d'être écrits par une liaison, si bien
  // qu'aucune passe ne tient le tampon dont elle se lance.
  const indirect = device.createBuffer({
    label: 'WG raster dispatch',
    size: DISPATCH_WORDS * 4,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  const b = SMALL_BINDINGS;
  const compute = GPUShaderStage.COMPUTE;
  const computeLayout = device.createBindGroupLayout({
    entries: [
      { binding: b.indices, visibility: compute, buffer: readOnly },
      { binding: b.positions, visibility: compute, buffer: readOnly },
      { binding: b.pages, visibility: compute, buffer: readOnly },
      { binding: b.hizFlags, visibility: compute, buffer: readOnly },
      { binding: b.uniform, visibility: compute, buffer: { type: 'uniform' } },
      { binding: b.uvs, visibility: compute, buffer: readOnly },
      ...b.maps.map((binding) => atlasLayoutEntry(binding, compute)),
      { binding: b.sampler, visibility: compute, sampler: {} },
      { binding: b.work, visibility: compute, buffer: { type: 'storage' } },
      { binding: b.selectionMask, visibility: compute, buffer: readOnly },
      { binding: b.colorSlots, visibility: compute, buffer: readOnly },
    ],
  });
  const computeModule = device.createShaderModule({ code: rasterSource(capacity, listOffset / 4) });
  const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
  const pipelineFor = (entryPoint: string) =>
    device.createComputePipeline({
      layout: computePipelineLayout,
      compute: { module: computeModule, entryPoint },
    });
  const clear = pipelineFor('clear'),
    bin = pipelineFor('bin'),
    plan = pipelineFor('plan');
  /** Un pipeline par classe et par mode : le mode ne voyage pas par un uniforme, il EST le point
   *  d'entrée, si bien qu'aucun lancement ne relit un mot pour savoir ce qu'il fait. */
  const raster = RASTER_CLASSES.map((klass) =>
    [MODE_DEPTH_OCCLUDER, MODE_DEPTH_REST, MODE_ID].map((mode) =>
      pipelineFor(rasterEntry(klass, mode)),
    ),
  );
  const resolves = createRasterResolves(device, RESOLVE, work, targetBytes);
  let group: GPUBindGroup | undefined;
  /** Les quatre lancements indirects d'un mode, dans une seule passe de calcul. */
  const encodeMode = (encoder: GPUCommandEncoder, mode: number, label: string) => {
    const pass = encoder.beginComputePass({ label });
    pass.setBindGroup(0, group!);
    for (let klass = 0; klass < RASTER_CLASSES.length; klass++) {
      pass.setPipeline(raster[klass]![mode]!);
      pass.dispatchWorkgroupsIndirect(indirect, klass * 12);
    }
    pass.end();
  };
  return {
    width,
    height,
    capacity,
    /**
     * Encode l'image entière du tampon de visibilité et rend le nombre de lancements de calcul.
     *
     * `midFrame` est la pyramide Hi-Z et son test : ils tournent entre la profondeur des occulteurs,
     * déjà reversée dans le niveau zéro, et le raster de la moitié testée qui lit leur verdict.
     * Sans lui — pas de partition, pas de pyramide — la moitié occulteurs est toute la coupe.
     */
    encode(
      encoder: GPUCommandEncoder,
      input: GpuRasterInput,
      midFrame?: (encoder: GPUCommandEncoder) => void,
    ) {
      // Toutes les ressources vivent plus longtemps que l'image : l'appelant garde les groupes et
      // nomme celui que cette combinaison de source de verdicts et de sélection emploie.
      group = (input.groups[input.groupKey] ??= device.createBindGroup({
        layout: computeLayout,
        entries: smallBindEntries({
          indices: input.indices,
          positions: input.positions,
          pages: input.pages,
          hizFlags: input.hizFlags,
          uniform: input.uniform,
          uniformSize: 96,
          uvs: input.uvs,
          colorAtlas: input.colorAtlas,
          sampler: input.sampler,
          work,
          selectionMask: input.selection?.maskBuffer ?? input.hizFlags,
          slots: input.slots,
        }),
      })) as GPUBindGroup;
      encoder.clearBuffer(work, listOffset, HEADER_CLEAR_BYTES);
      const rows = Math.max(1, input.pageRows),
        spanY = Math.min(rows, DISPATCH_SPAN),
        spanZ = Math.ceil(rows / DISPATCH_SPAN);
      const binning = encoder.beginComputePass({ label: 'WG raster binning' });
      binning.setBindGroup(0, group);
      binning.setPipeline(clear);
      binning.dispatchWorkgroups(Math.ceil((width * height) / 64));
      binning.setPipeline(bin);
      binning.dispatchWorkgroups(Math.max(1, Math.ceil(input.maxTriangles / 64)), spanY, spanZ);
      binning.setPipeline(plan);
      binning.dispatchWorkgroups(1);
      binning.end();
      encoder.copyBufferToBuffer(work, listOffset + 24, indirect, 0, DISPATCH_WORDS * 4);
      // Une passe par lancement de raster : deux lancements consécutifs voient déjà les écritures
      // l'un de l'autre, donc toutes les classes ont posé leur profondeur avant qu'aucune ne
      // choisisse un identifiant. Un identifiant choisi avant qu'une classe n'ait écrit sa
      // profondeur nommerait un triangle perdant.
      encodeMode(encoder, MODE_DEPTH_OCCLUDER, 'WG raster occluder depth');
      let dispatches = 3 + RASTER_CLASSES.length;
      if (midFrame) {
        resolves.encodeHiz(encoder, input, width, height);
        midFrame(encoder);
        if (!input.skipRest) {
          encodeMode(encoder, MODE_DEPTH_REST, 'WG raster tested depth');
          dispatches += RASTER_CLASSES.length;
        }
      }
      encodeMode(encoder, MODE_ID, 'WG raster identifiers');
      resolves.encodeFinal(encoder, input, width, height);
      return dispatches + RASTER_CLASSES.length;
    },
    dispose() {
      work.destroy();
      indirect.destroy();
    },
  };
}
export type GpuRaster = ReturnType<typeof createGpuRaster>;
