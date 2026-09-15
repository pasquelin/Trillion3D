import { BOUNCE_SETTINGS } from '../sdk-core/index.ts';
import { bounceGroup, bounceLayout } from './bounceBindings.ts';
import {
  BOUNCE_SURFACE_PASS,
  BOUNCE_SURFACE_SHADER,
  SURFACE_WORKGROUP,
} from './bounceSurfaceWgsl.ts';
import type { GpuBounceProxy } from './gpuBounceProxy.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';

/** Ce que la passe de cache lie : la grille, le proxy, les lampes, les sondes figées, le cache. */
const SURFACE_TYPES = [
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'uniform',
] as const;

export type GpuBounceSurface = Awaited<ReturnType<typeof createGpuBounceSurface>>;

/**
 * Le cache de surfaces du proxy et la passe qui le balaie (LR5).
 *
 * Une maille par triangle et par face, mise à jour sur un budget fixe de mailles par image. Le
 * balayage repart dès qu'une lampe change — c'est la même invalidation qu'une carte d'ombre — et
 * s'arrête de lui-même quand plus rien ne bouge : une scène immobile n'encode pas cette passe.
 */
export async function createGpuBounceSurface(
  device: GPUDevice,
  proxy: GpuBounceProxy,
  lights: GPUBuffer,
  grid: { uniform: GPUBuffer; snapshot: GPUBuffer },
) {
  const texels = Math.max(1, proxy.triangleCount * 2);
  const buffer = device.createBuffer({
    label: 'WG bounce surface cache v1',
    size: texels * 16,
    usage: GPUBufferUsage.STORAGE,
  });
  const span = device.createBuffer({
    label: 'WG bounce surface span v1',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const module = await createCheckedShaderModule(
    device,
    BOUNCE_SURFACE_SHADER,
    'BOUNCE_SURFACE_SHADER',
  );
  const layout = bounceLayout(device, [...SURFACE_TYPES]);
  let pipeline: GPUComputePipeline;
  try {
    pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'updateSurface' },
    });
  } catch (error) {
    buffer.destroy();
    span.destroy();
    throw error;
  }
  const group = bounceGroup(device, layout, [
    grid.uniform,
    proxy.triangles,
    proxy.albedo,
    proxy.nodeBounds,
    proxy.nodeChildren,
    lights,
    grid.snapshot,
    buffer,
    span,
  ]);
  const batch = Math.min(BOUNCE_SETTINGS.surfaceTexelsPerFrame, texels);
  const words = new Uint32Array(4);
  let cursor = 0,
    sweeps = 0,
    updated = 0;
  return {
    buffer,
    texels,
    /** Ce que le cache occupe en mémoire graphique, publié dans le diagnostic. */
    bytes: texels * 16,
    /** Images d'un balayage complet du cache : c'est l'autre moitié du retard de convergence. */
    sweepFrames: Math.max(1, Math.ceil(texels / batch)),
    /** Balayages complets depuis la dernière invalidation. */
    get sweeps() {
      return sweeps;
    },
    /** Mailles mises à jour par la dernière image encodée. */
    get lastTexels() {
      return updated;
    },
    /** Une lampe a changé : le cache entier est périmé et le balayage repart. */
    restart() {
      cursor = 0;
      sweeps = 0;
    },
    /** Encode un lot de mailles. La passe porte son étiquette : elle est mesurée à part. */
    encode(encoder: GPUCommandEncoder) {
      words[0] = cursor;
      words[1] = batch;
      device.queue.writeBuffer(span, 0, words);
      const pass = encoder.beginComputePass({ label: BOUNCE_SURFACE_PASS });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(batch / SURFACE_WORKGROUP), 1, 1);
      pass.end();
      updated = batch;
      cursor += batch;
      if (cursor >= texels) {
        cursor = 0;
        sweeps++;
      }
    },
    dispose() {
      buffer.destroy();
      span.destroy();
    },
  };
}
