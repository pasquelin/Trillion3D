import { generateMaterialMips } from './textureMips.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';

/** Tranches qu'un appareil peut refuser pour une même texture avant qu'elle quitte la file :
 *  au troisième refus elle est abandonnée, comptée dans `textureSkipped`, plus jamais réessayée. */
const MAX_FAILURES = 3;

/**
 * Admet un volume borné de transfert d'atlas par image. Une texture plus grosse que le budget
 * n'est jamais abandonnée : elle est découpée en bandes de lignes réparties sur plusieurs images,
 * dans l'ordre que la caméra dicte. Seul un refus répété de l'appareil fait sortir une texture.
 */
export function createWebgpuTexturePump(options: {
  device: GPUDevice | undefined;
  jobs: TextureJob[];
  budget: number;
  colorScales: Array<[number, number]>;
  dataScales: Array<[number, number]>;
  colorAtlas: () => { texture: GPUTexture | undefined; size: [number, number] };
  dataAtlas: () => { texture: GPUTexture | undefined; size: [number, number] };
  /** Réordonne la file selon ce que la caméra regarde, entre deux tranches seulement. */
  order: (jobs: TextureJob[]) => void;
  /** Les couches couleur dont la vraie texture est transférée et remipmappée passent à « prêt ». */
  onColorReady: (layers: readonly number[]) => void;
  onFailure: (phase: string, error: unknown) => void;
  /** Sortie définitive d'une texture de la file, avec la raison et l'avancement atteint. */
  onAbandon: (context: Record<string, unknown>) => void;
}) {
  let pending: Promise<void> | undefined;
  let uploaded = 0,
    skipped = 0,
    slices = 0,
    bytesLastPass = 0;
  const colorLayers: number[] = [],
    dataLayers: number[] = [];
  /** Transfère des tranches tant que le budget de l'image en laisse tenir une, file en tête. */
  const admit = () => {
    const { jobs, budget } = options;
    let admitted = 0;
    while (jobs.length) {
      const job = jobs[0];
      const room = Math.floor((budget - admitted) / job.bytesPerRow);
      // La ligne est indivisible : sans cette première ligne admise hors budget, une texture dont
      // une seule ligne dépasse le budget d'une image n'avancerait jamais.
      const rows = Math.min(job.rows - job.nextRow, Math.max(room, admitted ? 0 : 1));
      if (rows <= 0) break;
      try {
        job.uploadRows(job.nextRow, rows);
      } catch (error) {
        options.onFailure('progressive-texture-upload-failed', error);
        if (++job.failures >= MAX_FAILURES) {
          jobs.shift();
          skipped++;
          options.onAbandon({
            reason: 'transfer-refused',
            kind: job.kind,
            layer: job.layer,
            failures: job.failures,
            rowsTransferred: job.nextRow,
            rows: job.rows,
          });
        }
        break;
      }
      job.nextRow += rows;
      admitted += rows * job.bytesPerRow;
      slices++;
      // Une texture inachevée garde la tête : le budget de l'image est épuisé à une ligne près.
      if (job.nextRow < job.rows) break;
      jobs.shift();
      uploaded++;
      (job.kind === 'color' ? colorLayers : dataLayers).push(job.layer);
    }
    bytesLastPass = admitted;
  };
  const pump = () => {
    const { device, jobs } = options;
    if (pending || !jobs.length || !device) return pending ?? Promise.resolve();
    const run = async () => {
      colorLayers.length = 0;
      dataLayers.length = 0;
      options.order(jobs);
      admit();
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
        // Après la dernière tranche et ses mips seulement : avant, la couche n'est pas montrable.
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
    /** Textures transférées en entier, dernière tranche comprise. */
    get uploaded() {
      return uploaded;
    },
    /** Textures sorties de la file sur refus répété de l'appareil, jamais pour cause de taille. */
    get skipped() {
      return skipped;
    },
    /** Tranches réellement transférées depuis le début de la session. */
    get slices() {
      return slices;
    },
    /** Textures dont une tranche au moins est passée et qui en attendent d'autres. */
    get inFlight() {
      let count = 0;
      for (const job of options.jobs) if (job.nextRow > 0) count++;
      return count;
    },
    /** Octets admis par la dernière passe de la pompe. */
    get bytesLastPass() {
      return bytesLastPass;
    },
  };
}
