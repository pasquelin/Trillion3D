/**
 * Page side of the narrow resolve probe (#849): each scene's lights go through the engine's light
 * store and buffer, its view through the deferred view uniform, its shadows through the deferred
 * pass's substitutes; each tile record is bound as the resolve's `tileLights`, and the sums the
 * shipped resolve (`narrowResolveHarness.ts`) writes are read back as bits.
 */
import { createSceneLightStore, type SceneLight } from '../../../packages/sdk-core/src/index.ts';
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import {
  createDeferredPlaceholders,
  deferredLayoutEntries,
} from '../../../packages/sdk-browser/src/lighting/deferred/setup.ts';
import {
  ZERO_DIRECT,
  createDeferredView,
} from '../../../packages/sdk-browser/src/lighting/deferred/view.ts';
import { CONTRACT_SHADOW_BINDINGS } from '../../../packages/sdk-browser/src/lighting/direct/lightingWgsl.ts';
import { SUN_FAR_PROXY_BINDING } from '../../../packages/sdk-browser/src/gpu/shadow/sunFarShadowWgsl.ts';
import {
  SAMPLE_FLOATS,
  SAMPLES_BINDING,
  SUMS_BINDING,
  narrowResolveHarness,
} from './narrowResolveHarness.ts';
import { ouvrirAppareil } from './webgpuDevice.ts';

/** A tile record — its two counts, its lists, the pool after them — and the resolve reading it. */
export type ResolveRecord = { narrow: boolean; words: number[] };
export type ResolveScene = { lights: SceneLight[]; samples: number[]; records: ResolveRecord[] };

const storage = (
  device: GPUDevice,
  data: Uint32Array<ArrayBuffer> | Float32Array<ArrayBuffer>,
  read = false,
) => {
  const buffer = device.createBuffer({
    size: Math.max(data.byteLength, 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | (read ? GPUBufferUsage.COPY_SRC : 0),
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
};

export async function run(scenes: ResolveScene[]) {
  const opened = await ouvrirAppareil();
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const;
  const { device } = opened;
  const placeholders = createDeferredPlaceholders(device);
  const view = createDeferredView(device);
  // The resolve's own layout past the surfaces, seen by a compute stage, and the probe's two.
  const layout = device.createBindGroupLayout({
    entries: [
      ...deferredLayoutEntries(true)
        .filter(({ binding }) => binding >= 5)
        .map((entry) => ({ ...entry, visibility: GPUShaderStage.COMPUTE })),
      {
        binding: SAMPLES_BINDING,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      { binding: SUMS_BINDING, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const compilation: string[] = [];
  const pipelines = new Map<boolean, GPUComputePipeline>();
  for (const narrow of [false, true]) {
    const { module, compilation: errors } = await opened.compile(narrowResolveHarness(narrow));
    compilation.push(...errors.map((error) => `${narrow ? 'narrow' : 'wide'}: ${error}`));
    if (!errors.length)
      pipelines.set(
        narrow,
        device.createComputePipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          compute: { module, entryPoint: 'main' },
        }),
      );
  }
  const runs: number[][][] = [];
  for (const scene of scenes) {
    const store = createSceneLightStore();
    for (const light of scene.lights) store.add(light);
    const lights = {
      store,
      buffer: createSceneLightContractBuffer(device, store),
      uploadedEpoch: -1,
    };
    uploadSceneLights(device, lights as Parameters<typeof uploadSceneLights>[1]);
    // One tile: the view is one tile wide and high, every sample at its pixel, sampled rank 0.
    const direct = [scene.lights.length, 1, 1, ...ZERO_DIRECT.slice(3)];
    view.write(new Float32Array(16), [0, 0, 0, 1], 16, 16, 0, false, direct, 0);
    const samples = storage(device, new Float32Array(scene.samples));
    const count = scene.samples.length / SAMPLE_FLOATS;
    const sceneRuns: number[][] = [];
    for (const record of scene.records) {
      const pipeline = pipelines.get(record.narrow);
      if (!pipeline) continue;
      const tiles = storage(device, new Uint32Array(record.words));
      const sums = storage(device, new Uint32Array(count * 4), true);
      const entries: GPUBindGroupEntry[] = [
        { binding: 5, resource: { buffer: view.buffer } },
        { binding: 6, resource: { buffer: lights.buffer } },
        { binding: 7, resource: { buffer: tiles } },
        { binding: 8, resource: { buffer: placeholders.slices } },
        { binding: 9, resource: placeholders.atlasView },
        { binding: 10, resource: placeholders.sampler },
        { binding: SUN_FAR_PROXY_BINDING, resource: { buffer: placeholders.proxy } },
        { binding: CONTRACT_SHADOW_BINDINGS.requests, resource: { buffer: placeholders.requests } },
        {
          binding: CONTRACT_SHADOW_BINDINGS.transmittance,
          resource: placeholders.transmittanceView,
        },
        { binding: CONTRACT_SHADOW_BINDINGS.translucentDepth, resource: placeholders.atlasView },
        { binding: SAMPLES_BINDING, resource: { buffer: samples } },
        { binding: SUMS_BINDING, resource: { buffer: sums } },
      ];
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout, entries }));
      pass.dispatchWorkgroups(Math.ceil(count / 64));
      pass.end();
      device.queue.submit([encoder.finish()]);
      const bits = (await readGpuBuffer(device, sums, sums.size))!;
      sceneRuns.push([...bits.subarray(0, count * 4)]);
      tiles.destroy();
      sums.destroy();
    }
    runs.push(sceneRuns);
    samples.destroy();
    lights.buffer.destroy();
  }
  placeholders.dispose();
  view.dispose();
  const adapter = (await opened.fermer()).court;
  return { adapter, errors: [...opened.erreurs, ...compilation], runs };
}
