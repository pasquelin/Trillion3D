import { generateMaterialMips } from './textureMips.ts';
import type { TextureJob } from './webgpuAtlasCommon.ts';

/** Admits a bounded amount of atlas upload work per render call. */
export function createWebgpuTexturePump(options: {
  device: GPUDevice | undefined;
  jobs: TextureJob[];
  budget: number;
  colorScales: Array<[number, number]>;
  dataScales: Array<[number, number]>;
  colorAtlas: () => { texture: GPUTexture | undefined; size: [number, number] };
  dataAtlas: () => { texture: GPUTexture | undefined; size: [number, number] };
  /** Les couches couleur dont la vraie texture est transférée et remipmappée passent à « prêt ». */
  onColorReady: (layers: readonly number[]) => void;
  onFailure: (phase: string, error: unknown) => void;
}) {
  let pending: Promise<void> | undefined;
  let uploaded = 0;
  let skipped = 0;
  const pump = () => {
    const { device, jobs } = options;
    if (pending || !jobs.length || !device) return pending ?? Promise.resolve();
    const run = async () => {
      let admitted = 0;
      const colorLayers: number[] = [];
      const dataLayers: number[] = [];
      while (jobs.length && admitted + jobs[0].bytes <= options.budget) {
        const job = jobs.shift()!;
        try {
          job.upload();
          admitted += job.bytes;
          uploaded++;
          (job.kind === 'color' ? colorLayers : dataLayers).push(job.layer);
        } catch (error) {
          skipped++;
          options.onFailure('progressive-texture-upload-failed', error);
        }
      }
      if (jobs.length && jobs[0].bytes > options.budget) {
        jobs.shift();
        skipped++;
      }
      const color = options.colorAtlas();
      const data = options.dataAtlas();
      if (colorLayers.length && color.texture) {
        await generateMaterialMips(
          device,
          color.texture,
          'rgba8unorm-srgb',
          ...color.size,
          options.colorScales,
          colorLayers,
        );
        // Après le transfert complet et ses mips seulement : avant, la couche n'est pas montrable.
        options.onColorReady(colorLayers);
      }
      if (dataLayers.length && data.texture)
        await generateMaterialMips(
          device,
          data.texture,
          'rgba8unorm',
          ...data.size,
          options.dataScales,
          dataLayers,
        );
    };
    pending = run().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  return {
    pump,
    get pending() {
      return pending;
    },
    get uploaded() {
      return uploaded;
    },
    get skipped() {
      return skipped;
    },
  };
}
