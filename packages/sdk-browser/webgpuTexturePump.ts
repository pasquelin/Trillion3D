import { regenerateClassMips, type WebgpuAtlas } from './webgpuAtlasCommon.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';
import type { SlotPyramid } from './webgpuAtlasSlots.ts';

/** Tranches qu'un appareil peut refuser pour un même niveau avant qu'il quitte la file :
 *  au troisième refus il est abandonné, compté dans `textureSkipped`, plus jamais réessayé. */
const MAX_FAILURES = 3;

/** Les couches d'une classe dont la pleine résolution vient d'arriver. */
type ClassLayers = Map<number, number[]>;

async function regenerate(device: GPUDevice, atlas: WebgpuAtlas, byClass: ClassLayers) {
  for (const [classIndex, layers] of byClass) {
    const entry = atlas.classes[classIndex];
    if (entry) await regenerateClassMips(device, entry, layers);
  }
}

/**
 * Admet un volume borné de transfert d'atlas par image. Une texture plus grosse que le budget
 * n'est jamais abandonnée : elle est découpée en bandes de lignes réparties sur plusieurs images,
 * dans l'ordre que la caméra dicte. Seul un refus répété de l'appareil fait sortir un niveau.
 *
 * Les niveaux progressifs et la pleine résolution passent par la même file : les premiers écrivent
 * un niveau de mip et font avancer la résidence de la couche, la seconde déclenche la régénération
 * de toute la chaîne sur GPU, après quoi la couche repasse au chemin d'échantillonnage ordinaire.
 */
export function createWebgpuTexturePump(options: {
  device: GPUDevice | undefined;
  jobs: TextureJob[];
  budget: number;
  colorAtlas: () => WebgpuAtlas | undefined;
  dataAtlas: () => WebgpuAtlas | undefined;
  /** Réordonne la file selon ce que la caméra regarde, entre deux tranches seulement. */
  order: (jobs: TextureJob[]) => void;
  /** Un niveau progressif de plus est résident sur ce slot, dans la pyramide que porte son travail. */
  onLevel: (slot: number, level: number, pyramid: SlotPyramid | undefined) => void;
  /** Les slots couleur dont la vraie texture est transférée et remipmappée passent à « prêt ». */
  onColorReady: (slots: readonly number[]) => void;
  onFailure: (phase: string, error: unknown) => void;
  /** Sortie définitive d'un niveau de la file, avec la raison et l'avancement atteint. */
  onAbandon: (context: Record<string, unknown>) => void;
}) {
  let pending: Promise<void> | undefined;
  let uploaded = 0,
    skipped = 0,
    slices = 0,
    levels = 0,
    bytesLastPass = 0;
  const readySlots: number[] = [];
  const colorClasses: ClassLayers = new Map(),
    dataClasses: ClassLayers = new Map();
  const finished = (job: TextureJob) => {
    if (job.stage === 0) {
      levels++;
      options.onLevel(job.slot, job.level, job.pyramid);
      return;
    }
    uploaded++;
    const byClass = job.kind === 'color' ? colorClasses : dataClasses;
    const layers = byClass.get(job.classIndex);
    if (layers) layers.push(job.layer);
    else byClass.set(job.classIndex, [job.layer]);
    if (job.kind === 'color') readySlots.push(job.slot);
  };
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
            slot: job.slot,
            level: job.level,
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
      // Un niveau inachevé garde la tête : le budget de l'image est épuisé à une ligne près.
      if (job.nextRow < job.rows) break;
      jobs.shift();
      finished(job);
    }
    bytesLastPass = admitted;
  };
  const pump = () => {
    const { device, jobs } = options;
    if (pending || !jobs.length || !device) return pending ?? Promise.resolve();
    const run = async () => {
      readySlots.length = 0;
      colorClasses.clear();
      dataClasses.clear();
      options.order(jobs);
      admit();
      const color = options.colorAtlas(),
        data = options.dataAtlas();
      if (color && colorClasses.size) {
        await regenerate(device, color, colorClasses);
        // Après la dernière tranche et ses mips seulement : avant, la couche n'est pas montrable.
        options.onColorReady(readySlots);
      }
      if (data && dataClasses.size) await regenerate(device, data, dataClasses);
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
    /** Niveaux progressifs transférés en entier depuis le début de la session. */
    get levels() {
      return levels;
    },
    /** Niveaux sortis de la file sur refus répété de l'appareil, jamais pour cause de taille. */
    get skipped() {
      return skipped;
    },
    /** Tranches réellement transférées depuis le début de la session. */
    get slices() {
      return slices;
    },
    /** Niveaux dont une tranche au moins est passée et qui en attendent d'autres. */
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
