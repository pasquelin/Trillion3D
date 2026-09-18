import { regenerateClassMips, type WebgpuAtlas } from './webgpuAtlasCommon.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';
import type { SlotPyramid } from './webgpuAtlasSlots.ts';
import type { createTextureBudget } from './textureBudget.ts';

import { createTextureReads, MAX_FAILURES } from './webgpuTextureReads.ts';

/** Les couches d'une classe dont la pleine résolution vient d'arriver. */
type ClassLayers = Map<number, number[]>;

function regenerate(device: GPUDevice, atlas: WebgpuAtlas, byClass: ClassLayers) {
  for (const [classIndex, layers] of byClass) {
    const entry = atlas.classes[classIndex];
    if (entry) regenerateClassMips(device, entry, layers);
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
  /** Le registre d'octets engagés : il admet un niveau, ou défait un transfert moins utile. */
  ledger: ReturnType<typeof createTextureBudget>;
  /** Un niveau de plus est résident sur ce slot, quelle que soit sa nature. */
  onResident: (kind: TextureJob['kind'], slot: number, level: number) => void;
  /** Vrai dès qu'une caméra a dicté un ordre : avant, seules les queues d'aperçus partent. */
  screenKnown: () => boolean;
  /** Un niveau progressif de plus est résident sur ce slot, dans la pyramide que porte son travail. */
  onLevel: (
    kind: TextureJob['kind'],
    slot: number,
    level: number,
    pyramid: SlotPyramid | undefined,
  ) => void;
  /** Les slots dont la vraie texture est transférée et remipmappée passent à « prêt ». */
  onReady: (kind: TextureJob['kind'], slots: readonly number[]) => void;
  onFailure: (phase: string, error: unknown) => void;
  /** Sortie définitive d'un niveau de la file, avec la raison et l'avancement atteint. */
  onAbandon: (context: Record<string, unknown>) => void;
}) {
  let uploaded = 0,
    skipped = 0,
    slices = 0,
    levels = 0,
    bytesLastPass = 0;
  const readySlots = { color: [] as number[], data: [] as number[] };
  const colorClasses: ClassLayers = new Map(),
    dataClasses: ClassLayers = new Map();
  const finished = (job: TextureJob) => {
    options.onResident(job.kind, job.slot, job.level);
    if (job.stage === 0) {
      levels++;
      options.onLevel(job.kind, job.slot, job.level, job.pyramid);
      return;
    }
    uploaded++;
    const byClass = job.kind === 'color' ? colorClasses : dataClasses;
    const layers = byClass.get(job.classIndex);
    if (layers) layers.push(job.layer);
    else byClass.set(job.classIndex, [job.layer]);
    readySlots[job.kind].push(job.slot);
  };
  const reads = createTextureReads({
    jobs: options.jobs,
    onFailure: options.onFailure,
    onAbandon: (job, reason) => {
      skipped++;
      const { kind, slot, level, failures, rows, nextRow: rowsTransferred } = job;
      options.onAbandon({ reason, kind, slot, level, failures, rowsTransferred, rows });
    },
  });
  /**
   * Transfère des tranches tant que le budget de l'image en laisse tenir une. La file est parcourue
   * dans son ordre : un niveau que le registre d'octets refuse est sauté, jamais abandonné — il
   * repassera quand la caméra le rendra utile ou qu'un transfert moins utile aura libéré sa place.
   */
  const admit = (unbounded: boolean) => {
    const { jobs, budget, ledger } = options;
    let admitted = 0,
      at = 0;
    while (at < jobs.length) {
      const job = jobs[at];
      // Avant la première caméra, la pleine résolution attend : la préparation transfère les queues
      // d'aperçus, qui rendent l'image lisible, et laisse l'écran dicter la suite. Une barrière
      // explicite (`flush`) passe outre — elle doit converger, caméra ou non.
      if (job.stage === 1 && !unbounded && !options.screenKnown()) {
        at++;
        continue;
      }
      // Un niveau cuit dont les octets ne sont pas encore là ne bloque pas les suivants.
      if (!job.ready || !ledger.admits(job, jobs, unbounded)) {
        at++;
        continue;
      }
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
          ledger.commit(-job.nextRow * job.bytesPerRow);
          reads.abandon(job, 'transfer-refused');
        }
        break;
      }
      job.nextRow += rows;
      admitted += rows * job.bytesPerRow;
      ledger.commit(rows * job.bytesPerRow);
      slices++;
      // Un niveau inachevé garde sa place : le budget de l'image est épuisé à une ligne près.
      if (job.nextRow < job.rows) break;
      jobs.splice(at, 1);
      finished(job);
    }
    bytesLastPass = admitted;
  };
  /**
   * Une passe de transfert. Tout y est synchrone : les tranches partent par `writeTexture`, les
   * réductions par `submit`, et la file de l'appareil les exécute dans l'ordre où elles sont
   * soumises — donc avant l'image qui lira la couche. Rien n'attend l'appareil, sans quoi la passe
   * suivante ne partirait qu'un aller-retour GPU plus tard et le flux des textures se traînerait.
   *
   * `unbounded` lève le budget d'octets engagés : seul `flush()` le demande, pour converger.
   */
  const pump = (unbounded = false) => {
    const { device, jobs } = options;
    if (!jobs.length || !device) return;
    readySlots.color.length = 0;
    readySlots.data.length = 0;
    colorClasses.clear();
    dataClasses.clear();
    options.order(jobs);
    // Avant la première caméra, aucun niveau cuit n'est lu : comme la pleine résolution, il attend
    // que l'écran dise lequel sert. La barrière passe outre, elle doit converger.
    if (unbounded || options.screenKnown()) reads.prefetch();
    admit(unbounded);
    const color = options.colorAtlas(),
      data = options.dataAtlas();
    if (color && colorClasses.size) {
      regenerate(device, color, colorClasses);
      // Après la dernière tranche et ses mips seulement : avant, la couche n'est pas montrable.
      options.onReady('color', readySlots.color);
    }
    if (data && dataClasses.size) {
      regenerate(device, data, dataClasses);
      options.onReady('data', readySlots.data);
    }
  };
  return {
    pump,
    /** Tenue quand toutes les lectures en vol ont abouti ou échoué ; `null` sans lecture en vol.
     *  C'est ce qu'une barrière attend entre deux passes pour converger. */
    settled: reads.settled,
    /** Niveaux cuits lus dans le cache ; textures transférées en entier ; niveaux progressifs
     *  transférés ; niveaux sortis de la file sur refus répété — jamais pour cause de taille ;
     *  tranches réellement transférées ; octets admis par la dernière passe. Depuis le début. */
    get fetched() {
      return reads.fetched;
    },
    get uploaded() {
      return uploaded;
    },
    get levels() {
      return levels;
    },
    get skipped() {
      return skipped;
    },
    get slices() {
      return slices;
    },
    get bytesLastPass() {
      return bytesLastPass;
    },
    /** Niveaux dont une tranche au moins est passée et qui en attendent d'autres. */
    get inFlight() {
      let count = 0;
      for (const job of options.jobs) if (job.nextRow > 0) count++;
      return count;
    },
  };
}
