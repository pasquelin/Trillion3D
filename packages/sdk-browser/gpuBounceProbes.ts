import {
  BOUNCE_SETTINGS,
  PROBE_FLOATS,
  createBounceBudget,
  createBounceCascades,
  createBounceOccupancy,
  type SceneProxy,
} from '../sdk-core/index.ts';
import { bounceGroup, bounceLayout } from './bounceBindings.ts';
import { BOUNCE_PROBE_PASS, BOUNCE_PROBE_SHADER } from './bounceProbeWgsl.ts';
import { createBounceSchedule } from './bounceSchedule.ts';
import { createBounceUniform } from './bounceUniform.ts';
import { createGpuBounceProxy } from './gpuBounceProxy.ts';
import { createGpuBounceSurface, type GpuBounceSurface } from './gpuBounceSurface.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';

/** Ce que la passe de sondes lie : les cascades, le proxy, la file de l'image, les sondes figées,
 *  les neuves, le cache. Les lampes n'y sont plus : le cache les a évaluées par maille. */
const PROBE_TYPES: (GPUBufferBindingType | null)[] = [
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'read-only-storage',
];

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>;

/**
 * Les cascades de sondes d'irradiance, le cache de surfaces, et les deux passes qui les balaient.
 *
 * Le budget est une **durée**, pas un compte (X4, LR2) : l'hôte donne une cible en millisecondes,
 * le chronomètre de l'étape « Rebond » la compare à ce que l'image a coûté, et la fraction des
 * plafonds publiés que l'image suivante encodera monte ou descend. La cadence ne cède jamais ;
 * c'est la convergence qui s'allonge. Quand plus rien ne change, aucune des deux passes n'est
 * encodée : une scène immobile ne paie rien.
 */
export async function createGpuBounceProbes(
  device: GPUDevice,
  proxy: SceneProxy,
  lights: GPUBuffer,
  budgetMs: number,
) {
  const cascades = createBounceCascades(proxy.bounds);
  const occupancy = createBounceOccupancy(proxy, cascades);
  const schedule = createBounceSchedule(cascades, occupancy);
  const budget = createBounceBudget(budgetMs);
  const resident = createGpuBounceProxy(device, proxy);
  const uniform = createBounceUniform(device, cascades);
  const queue = device.createBuffer({
    label: 'WG bounce probe queue v1',
    size: schedule.queue.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const probeBytes = Math.max(16, cascades.probes * PROBE_FLOATS * 4);
  const probes = device.createBuffer({
    label: 'WG bounce probes v2',
    size: probeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  // La copie que les deux passes lisent : figée avant elles, si bien qu'un rebond d'ordre supérieur
  // voit toujours les cascades entières de l'image précédente, et jamais une voisine à demi écrite.
  const snapshot = device.createBuffer({
    label: 'WG bounce probes snapshot v2',
    size: probeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const release = () => {
    queue.destroy();
    uniform.dispose();
    probes.destroy();
    snapshot.destroy();
    resident.dispose();
  };
  let surface: GpuBounceSurface;
  let pipeline: GPUComputePipeline;
  let group: GPUBindGroup;
  try {
    surface = await createGpuBounceSurface(device, resident, lights, {
      uniform: uniform.buffer,
      snapshot,
    });
    const module = await createCheckedShaderModule(device, BOUNCE_PROBE_SHADER, 'BOUNCE_PROBE');
    const layout = bounceLayout(device, PROBE_TYPES);
    pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'updateProbes' },
    });
    group = bounceGroup(device, layout, [
      uniform.buffer,
      resident.triangles,
      resident.albedo,
      resident.nodeBounds,
      resident.nodeChildren,
      queue,
      snapshot,
      probes,
      surface.buffer,
    ]);
  } catch (error) {
    release();
    throw error;
  }
  /** Plafond des sondes d'une image : le budget de rayons publié, divisé par les rayons d'une sonde. */
  const ceiling = Math.max(
    1,
    Math.floor(BOUNCE_SETTINGS.raysPerFrame / BOUNCE_SETTINGS.raysPerProbe),
  );
  let generation = 1,
    frame = 0,
    updates = 0;
  /** Tours complets : un balayage des cascades et un balayage du cache, le plus lent des deux. */
  const rounds = () => Math.min(schedule.sweeps, surface.sweeps);
  const batch = () => Math.max(1, Math.round(ceiling * budget.load));
  return {
    cascades,
    occupancy,
    budget,
    surface,
    proxy: resident,
    uniform: uniform.buffer,
    probes,
    /** Images d'un tour complet, mesurées : c'est la borne du retard de convergence. */
    get sweepFrames() {
      return Math.max(schedule.sweepFrames, surface.sweepFrames, 1);
    },
    /** Sondes que la carte d'occupation retient au niveau le plus fin, sur ses mailles. */
    activeProbes: occupancy.marked,
    /** Sondes mises à jour par la dernière image encodée, et rayons qu'elles ont lancés. */
    get lastProbes() {
      return updates;
    },
    get lastRays() {
      return updates * BOUNCE_SETTINGS.raysPerProbe;
    },
    /** Vrai tant que la série des rebonds n'est pas close : au-delà, plus rien n'est encodé. */
    get working() {
      return rounds() < BOUNCE_SETTINGS.settledSweeps;
    },
    /** Le chronomètre de l'étape, tel que le profil par étape l'a relevé. `null` n'est pas zéro. */
    observeGpuMs(ms: number | null) {
      budget.observe(ms);
    },
    setIrradianceView: uniform.setIrradianceView,
    /** Une lampe a changé : les balayages repartent, les sondes endormies se réveillent. */
    restart() {
      generation++;
      schedule.restart();
      surface.restart();
    },
    /**
     * Encode un tour de cache puis un lot de sondes. Rend `false` quand il n'y avait rien à faire :
     * la scène est immobile, la série est close, et l'étape « Rebond » vaut « non mesuré ».
     */
    encode(encoder: GPUCommandEncoder, lightsActive: number, viewpoint: ArrayLike<number>) {
      updates = 0;
      // Une cascade qui glisse fait entrer des mailles neuves : c'est du travail, comme une lampe
      // qui bouge. Une caméra immobile ne fait glisser personne et ne relance donc rien.
      if (cascades.follow(viewpoint)) schedule.restart();
      if (!cascades.probes || !lightsActive || !this.working) return false;
      frame++;
      const groups = schedule.plan(batch());
      if (groups) device.queue.writeBuffer(queue, 0, schedule.queue, 0, groups);
      uniform.write(generation, groups, frame);
      encoder.copyBufferToBuffer(probes, 0, snapshot, 0, probeBytes);
      surface.encode(encoder, budget.load);
      // Une file vide — aucune maille de la scène ne mérite une sonde — n'encode pas la passe :
      // le cache de surfaces, lui, continue son balayage, qui ne dépend d'aucune sonde.
      if (groups) {
        const pass = encoder.beginComputePass({ label: BOUNCE_PROBE_PASS });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        // Un groupe de travail par sonde : les rayons d'une sonde se partagent ses fils.
        pass.dispatchWorkgroups(groups, 1, 1);
        pass.end();
      }
      updates = groups;
      return true;
    },
    dispose() {
      surface.dispose();
      release();
    },
  };
}
