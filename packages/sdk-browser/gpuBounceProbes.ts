import { BOUNCE_SETTINGS, PROBE_FLOATS, probeGridOf, type SceneProxy } from '../sdk-core/index.ts';
import { BOUNCE_PROBE_PASS, BOUNCE_PROBE_SHADER, BOUNCE_WORKGROUP } from './bounceProbeWgsl.ts';
import { createGpuBounceProxy, type GpuBounceProxy } from './gpuBounceProxy.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';

/** Les liaisons de la passe : la grille, les quatre colonnes du proxy, les lampes, les sondes. */
function probeLayout(device: GPUDevice) {
  const storage = (binding: number, type: GPUBufferBindingType) => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type },
  });
  return device.createBindGroupLayout({
    entries: [
      storage(0, 'uniform'),
      storage(1, 'read-only-storage'),
      storage(2, 'read-only-storage'),
      storage(3, 'read-only-storage'),
      storage(4, 'read-only-storage'),
      storage(5, 'read-only-storage'),
      storage(6, 'read-only-storage'),
      storage(7, 'storage'),
    ],
  });
}

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>;

/**
 * La grille de sondes d'irradiance et la passe qui la met à jour.
 *
 * Le budget est fixe : `probesPerFrame` sondes par image, `raysPerProbe` rayons chacune. La grille
 * entière est balayée en un nombre connu d'images, et c'est ce nombre qui borne le retard. Quand
 * plus rien ne change — aucune lampe déclarée n'a bougé et la grille est balayée depuis assez
 * longtemps — la passe n'est plus encodée du tout : une scène immobile ne paie rien.
 */
export async function createGpuBounceProbes(
  device: GPUDevice,
  proxy: SceneProxy,
  lights: GPUBuffer,
) {
  const grid = probeGridOf(proxy.bounds);
  const resident = createGpuBounceProxy(device, proxy);
  const module = await createCheckedShaderModule(
    device,
    BOUNCE_PROBE_SHADER,
    'BOUNCE_PROBE_SHADER',
  );
  const layout = probeLayout(device);
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
  // La copie que la passe lit : figée avant la mise à jour, si bien qu'un rebond d'ordre supérieur
  // voit toujours la grille entière de l'image précédente, et jamais une voisine à demi écrite.
  const snapshot = device.createBuffer({
    label: 'WG bounce probes snapshot v1',
    size: probeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  let pipeline: GPUComputePipeline;
  try {
    pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'updateProbes' },
    });
  } catch (error) {
    uniform.destroy();
    probes.destroy();
    snapshot.destroy();
    resident.dispose();
    throw error;
  }
  const group = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: resident.triangles } },
      { binding: 2, resource: { buffer: resident.albedo } },
      { binding: 3, resource: { buffer: resident.nodeBounds } },
      { binding: 4, resource: { buffer: resident.nodeChildren } },
      { binding: 5, resource: { buffer: lights } },
      { binding: 6, resource: { buffer: snapshot } },
      { binding: 7, resource: { buffer: probes } },
    ],
  });
  // La portée d'un rayon : une fraction de la diagonale de l'emprise. Au-delà, un rayon ne peut
  // plus rien toucher qui compte, et le faire voyager coûterait sans rien rapporter.
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
  // relit à chaque image, même convergée, quand plus aucune passe de sondes n'est encodée.
  device.queue.writeBuffer(uniform, 0, packed);
  let cursor = 0,
    sweep = 0,
    settled = 0,
    updates = 0;
  const batch = Math.min(BOUNCE_SETTINGS.probesPerFrame, grid.probes);
  return {
    grid,
    proxy: resident as GpuBounceProxy,
    uniform,
    probes,
    /** Images d'un balayage complet : c'est la borne du retard de convergence. */
    sweepFrames: Math.max(1, Math.ceil(grid.probes / Math.max(batch, 1))),
    /** Sondes mises à jour par la dernière image encodée, et rayons qu'elles ont lancés. */
    get lastProbes() {
      return updates;
    },
    get lastRays() {
      return updates * BOUNCE_SETTINGS.raysPerProbe;
    },
    /** Vrai tant que la grille n'a pas convergé : au-delà, la passe n'est plus encodée. */
    get working() {
      return settled < BOUNCE_SETTINGS.settledSweeps;
    },
    /**
     * La vue de diagnostic d'irradiance indirecte : la résolution différée sort alors l'irradiance
     * nue au lieu de l'image. Le drapeau voyage dans le même uniforme que la grille, et il est
     * relu par le nuanceur d'application, jamais par celui des sondes.
     */
    setIrradianceView(on: boolean) {
      if (irradianceView === on) return;
      irradianceView = on;
      floats[7] = on ? 1 : 0;
      device.queue.writeBuffer(uniform, 0, packed);
    },
    /** Une lampe a changé : la grille repart, et le retard se remesure depuis cette image. */
    restart() {
      settled = 0;
      sweep = 0;
    },
    /**
     * Encode un lot de sondes. Rend `false` quand il n'y avait rien à faire : la scène est
     * immobile, la grille est convergée, et l'étape « Rebond » vaut « non mesuré », jamais zéro.
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
        settled++;
      }
      return true;
    },
    dispose() {
      uniform.destroy();
      probes.destroy();
      snapshot.destroy();
      resident.dispose();
    },
  };
}
