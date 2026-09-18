import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { createWebgpuVisibilityShaders } from './webgpuVisibilityShaders.ts';
import { createWebgpuShadePipeline } from './webgpuVisibilityPipelines.ts';
import { createWebgpuBlendPipelines } from './webgpuBlendPipelines.ts';
import { createGpuRaster } from './gpuRaster.ts';
import { createTemporalAntialiasing } from './temporalAntialiasing.ts';

/** Le dispositif factice des dispositions : il ne garde que ce qu'on lui demande de créer. */
function recordingDevice() {
  return {
    createBuffer: ({ size, usage }: { size: number; usage: number }) => ({ size, usage }),
    createBindGroupLayout: (desc: unknown) => desc,
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createComputePipeline: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroup: (desc: unknown) => desc,
    createSampler: () => ({}),
    queue: { writeBuffer() {} },
  } as unknown as GPUDevice;
}

// Le défaut que ce test attrape : une disposition gagne un tampon de stockage de plus que le
// minimum garanti par WebGPU, et le dispositif refuse de la créer — « The number of storage buffers
// (9) in the Compute stage exceeds the maximum per-stage limit (8) » — puis se perd. Aucune porte
// ne le voyait : les tests bâtissent les dispositions sur un dispositif factice, sans limites.
const GUARANTEED_STORAGE_BUFFERS_PER_STAGE = 8;

test('aucune disposition ne dépasse les huit tampons de stockage garantis par étage', async () => {
  installGpuGlobals();
  const device = recordingDevice();
  const { visBindGroupLayout } = await createWebgpuVisibilityShaders(device, 8);
  const { shadeBindGroupLayout } = await createWebgpuShadePipeline(device, {} as GPUShaderModule);
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  const layouts: Array<[string, unknown]> = [
    ['visibilité', visBindGroupLayout],
    ['résolution matérielle', shadeBindGroupLayout],
    ['transparents', blendBindGroupLayout],
    ['petits triangles', await firstLayout(device, (d) => createGpuRaster(d, 4, 4, 8))],
    ['antialiasing temporel', await firstLayout(device, (d) => createTemporalAntialiasing(d, []))],
  ];
  const stages = {
    VERTEX: GPUShaderStage.VERTEX,
    FRAGMENT: GPUShaderStage.FRAGMENT,
    COMPUTE: GPUShaderStage.COMPUTE,
  };
  for (const [name, layout] of layouts) {
    const entries = (
      layout as { entries: Array<{ visibility: number; buffer?: { type?: string } }> }
    ).entries;
    for (const [stage, bit] of Object.entries(stages)) {
      const count = entries.filter(
        (entry) =>
          (entry.visibility & bit) !== 0 &&
          (entry.buffer?.type === 'storage' || entry.buffer?.type === 'read-only-storage'),
      ).length;
      assert.ok(
        count <= GUARANTEED_STORAGE_BUFFERS_PER_STAGE,
        `${name} lie ${count} tampons de stockage à l’étage ${stage}, au-dessus des ${GUARANTEED_STORAGE_BUFFERS_PER_STAGE} garantis`,
      );
    }
  }
});

/** La première disposition qu'un constructeur crée sur le dispositif factice. */
async function firstLayout(device: GPUDevice, build: (recording: GPUDevice) => unknown) {
  const layouts: unknown[] = [];
  const recording = {
    ...device,
    createBindGroupLayout: (descriptor: unknown) => {
      layouts.push(descriptor);
      return descriptor;
    },
  } as unknown as GPUDevice;
  await build(recording);
  return layouts[0];
}
