import { BOUNCE_SETTINGS, PROBE_FLOATS, probeGridOf, type SceneProxy } from '../sdk-core/index.ts';
import { bounceGroup, bounceLayout } from './bounceBindings.ts';
import { BOUNCE_PROBE_PASS, BOUNCE_PROBE_SHADER, BOUNCE_WORKGROUP } from './bounceProbeWgsl.ts';
import { createGpuBounceProxy } from './gpuBounceProxy.ts';
import { createGpuBounceSurface } from './gpuBounceSurface.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';

/** Ce que la passe de sondes lie : la grille, le proxy, les sondes figées, les neuves, le cache.
 *  Les lampes n'y sont plus : c'est le cache de surfaces qui les évalue, une fois par maille. */
const PROBE_TYPES = [
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  null,
  'read-only-storage',
  'storage',
  'read-only-storage',
] as const;

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>;

/**
 * La grille de sondes d'irradiance, le cache de surfaces, et les deux passes qui les balaient.
 *
 * Le budget est fixe des deux côtés : `probesPerFrame` sondes à `raysPerProbe` rayons, et
 * `surfaceTexelsPerFrame` mailles de cache. Un tour complet — un balayage de chacun — ajoute un
 * ordre de rebond à la série ; c'est ce tour qui borne le retard. Quand plus rien ne change, aucune
 * des deux passes n'est encodée : une scène immobile ne paie rien.
 */
export async function createGpuBounceProbes(
  device: GPUDevice,
  proxy: SceneProxy,
  lights: GPUBuffer,
) {
  const grid = probeGridOf(proxy.bounds);
  const resident = createGpuBounceProxy(device, proxy);
  const uniform = device.createBuffer({
    label: 'WG bounce grid v1',
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const probeBytes = Math.max(16, grid.probes * PROBE_FLOATS * 4);
  const probes = device.createBuffer({
    label: 'WG bounce probes v1',
    size: probeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  // La copie que les deux passes lisent : figée avant elles, si bien qu'un rebond d'ordre supérieur
  // voit toujours la grille entière de l'image précédente, et jamais une voisine à demi écrite.
  const snapshot = device.createBuffer({
    label: 'WG bounce probes snapshot v1',
    size: probeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const release = () => {
    uniform.destroy();
    probes.destroy();
    snapshot.destroy();
    resident.dispose();
  };
  let surface: Awaited<ReturnType<typeof createGpuBounceSurface>>;
  let pipeline: GPUComputePipeline;
  let group: GPUBindGroup;
  try {
    surface = await createGpuBounceSurface(device, resident, lights, { uniform, snapshot });
    const module = await createCheckedShaderModule(device, BOUNCE_PROBE_SHADER, 'BOUNCE_PROBE');
    const layout = bounceLayout(device, [...PROBE_TYPES]);
    pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'updateProbes' },
    });
    group = bounceGroup(device, layout, [
      uniform,
      resident.triangles,
      resident.albedo,
      resident.nodeBounds,
      resident.nodeChildren,
      null,
      snapshot,
      probes,
      surface.buffer,
    ]);
  } catch (error) {
    release();
    throw error;
  }
  // La portée d'un rayon : la diagonale de l'emprise. Au-delà, un rayon ne peut plus rien toucher.
  const diagonal = Math.hypot(
    proxy.bounds[3] - proxy.bounds[0],
    proxy.bounds[4] - proxy.bounds[1],
    proxy.bounds[5] - proxy.bounds[2],
  );
  const packed = new ArrayBuffer(64);
  const floats = new Float32Array(packed),
    words = new Uint32Array(packed);
  floats.set([...grid.origin, diagonal * BOUNCE_SETTINGS.rayReachFraction], 0);
  floats.set([...grid.spacing, 0], 4);
  words.set([...grid.counts, grid.probes], 8);
  let irradianceView = false;
  // L'uniforme est écrit une fois à la construction, la grille entière dedans : l'application le
  // relit à chaque image, même convergée, quand plus aucune passe n'est encodée.
  device.queue.writeBuffer(uniform, 0, packed);
  let cursor = 0,
    sweep = 0,
    updates = 0;
  const batch = Math.min(BOUNCE_SETTINGS.probesPerFrame, grid.probes);
  /** Tours complets : un balayage de la grille et un balayage du cache, le plus lent des deux. */
  const rounds = () => Math.min(sweep, surface.sweeps);
  return {
    grid,
    surface,
    proxy: resident,
    uniform,
    probes,
    /** Images d'un tour complet : c'est la borne du retard de convergence. */
    sweepFrames: Math.max(Math.ceil(grid.probes / Math.max(batch, 1)), surface.sweepFrames, 1),
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
    /**
     * La vue de diagnostic d'irradiance indirecte : la résolution différée sort alors l'irradiance
     * nue au lieu de l'image. Le drapeau voyage dans le même uniforme que la grille, et il est
     * relu par le nuanceur d'application, jamais par ceux des deux passes.
     */
    setIrradianceView(on: boolean) {
      if (irradianceView === on) return;
      irradianceView = on;
      floats[7] = on ? 1 : 0;
      device.queue.writeBuffer(uniform, 0, packed);
    },
    /** Une lampe a changé : les deux balayages repartent, et le retard se remesure d'ici. */
    restart() {
      sweep = 0;
      surface.restart();
    },
    /**
     * Encode un tour de cache puis un lot de sondes. Rend `false` quand il n'y avait rien à faire :
     * la scène est immobile, la série est close, et l'étape « Rebond » vaut « non mesuré ».
     */
    encode(encoder: GPUCommandEncoder, lightsActive: number) {
      updates = 0;
      if (!grid.probes || !lightsActive || !this.working) return false;
      words[12] = cursor;
      words[13] = batch;
      words[14] = sweep + 1;
      words[15] = lightsActive;
      device.queue.writeBuffer(uniform, 0, packed);
      encoder.copyBufferToBuffer(probes, 0, snapshot, 0, probeBytes);
      surface.encode(encoder);
      const pass = encoder.beginComputePass({ label: BOUNCE_PROBE_PASS });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(batch / BOUNCE_WORKGROUP), 1, 1);
      pass.end();
      updates = batch;
      cursor += batch;
      if (cursor >= grid.probes) {
        cursor = 0;
        sweep++;
      }
      return true;
    },
    dispose() {
      surface.dispose();
      release();
    },
  };
}
