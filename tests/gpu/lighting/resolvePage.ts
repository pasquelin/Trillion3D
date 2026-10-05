/**
 * The deferred resolve's lists on the GPU (#849, #1249, #1369): each scene's lights go through the
 * engine's light store and buffer, its view through the deferred view uniform, its shadows through
 * the deferred pass's own stand-ins (`createDeferredPlaceholders`); each cell record is bound as the
 * resolve's tile lists, and the sums the shipped resolve writes (`resolveHarness.ts`) are read back
 * as f32 bits.
 *
 * The bindings are the resolve's layout (`deferredLayoutEntries`) seen by a compute stage, minus
 * what the harness never reads; each is given the resource the deferred program binds there when a
 * frame has none of its own (`lighting/deferred/program.ts`). A binding the layout gains and this
 * page does not know fails by its number, never as a drifted copy.
 */
import { createSceneLightStore, type SceneLight } from '../../../packages/sdk-core/src/index.ts';
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts';
import { createWebgpuLightState } from '../../../packages/sdk-browser/src/webgpu/pages/state/lights.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import {
  createDeferredPlaceholders,
  deferredLayoutEntries,
} from '../../../packages/sdk-browser/src/lighting/deferred/setup.ts';
import {
  ZERO_DIRECT,
  createDeferredView,
} from '../../../packages/sdk-browser/src/lighting/deferred/view.ts';
import { LIGHTING_RECEIVER_BINDING } from '../../../packages/sdk-browser/src/lighting/deferred/surfaceWgsl.ts';
import { CONTRACT_SHADOW_BINDINGS } from '../../../packages/sdk-browser/src/lighting/direct/lightingWgsl.ts';
import { CONTRACT_VSM_BINDINGS } from '../../../packages/sdk-browser/src/lighting/direct/shadowWgsl.ts';
import { VSM_TRANSMISSION_RESOLVE_BINDING } from '../../../packages/sdk-browser/src/vsm/transmissionWgsl.ts';
import {
  VSM_MASK_TABLE_BINDING,
  VSM_MASK_TILES_BINDING,
} from '../../../packages/sdk-browser/src/vsm/projectionMaskTable.ts';
import { RESIDENT_PROXY_BINDING } from '../../../packages/sdk-browser/src/bounce/nodeWgsl.ts';
import { RECEIVER_BINDINGS } from '../../../packages/sdk-browser/src/visibility/shader/receiverOffsetWgsl.ts';
import { SUBSURFACE_BINDING } from '../../../packages/sdk-browser/src/scene/subsurface.ts';
import { SAMPLE_FLOATS, SAMPLES_BINDING, SUMS_BINDING, resolveHarness } from './resolveHarness.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';

/** The resolve's bindings the harness never reads: the surfaces, the receiver offset's and the
 *  subsurface. */
const UNREAD = new Set([
  ...RECEIVER_BINDINGS.map((_, i) => LIGHTING_RECEIVER_BINDING + i),
  SUBSURFACE_BINDING,
]);

/** A cell record — its count, the shadow flag in its high bit, where its list starts in the pool —
 *  and the resolve reading it: `contractLighting`, or with `drawn` `sampledSliceLighting` alone;
 *  `name` the key its sums are read back under. */
type ResolveRecord = {
  name: string;
  narrow: boolean;
  words: number[];
  drawn?: boolean;
  /** Through the program with no shadow code (#1249). */
  unshadowed?: boolean;
  /** Through the program with no rectangle code (#1369). */
  rectless?: boolean;
};
/** A scene; `rank` the view's sampled rank (0, a still image, by default), `slots` the shadow slot
 *  of some lights by their index. */
export type ResolveScene = {
  lights: SceneLight[];
  samples: number[];
  records: ResolveRecord[];
  rank?: number;
  slots?: [number, number][];
};

export async function run(scenes: ResolveScene[]) {
  const opened = await openGpuDevice();
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const;
  const { device } = opened;
  const storage = (data: Uint32Array<ArrayBuffer> | Float32Array<ArrayBuffer>, read = false) => {
    const buffer = device.createBuffer({
      size: Math.max(data.byteLength, 16),
      usage:
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | (read ? GPUBufferUsage.COPY_SRC : 0),
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  const placeholders = createDeferredPlaceholders(device);
  const view = createDeferredView(device);
  const resolveEntries = deferredLayoutEntries(true)
    .filter(({ binding }) => binding >= 5 && !UNREAD.has(binding))
    .map((entry) => ({ ...entry, visibility: GPUShaderStage.COMPUTE }));
  const layout = device.createBindGroupLayout({
    entries: [
      ...resolveEntries,
      {
        binding: SAMPLES_BINDING,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      { binding: SUMS_BINDING, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const compilation: string[] = [];
  /** A record's program, compiled the first time a record asks for it — narrow or wide, with or
   *  without its shadow and rectangle code —, and its pipelines at the `main` and `drawn` entries. */
  const programs = new Map<string, Promise<Record<string, GPUComputePipeline> | undefined>>();
  const programOf = ({ narrow, unshadowed = false, rectless = false }: ResolveRecord) => {
    const key = `${narrow}/${unshadowed}/${rectless}`;
    if (!programs.has(key))
      programs.set(
        key,
        opened
          .compile(resolveHarness(narrow, !unshadowed, !rectless))
          .then(({ module, compilation: errors }) => {
            compilation.push(...errors.map((error) => `${key}: ${error}`));
            if (errors.length) return undefined;
            const pipeline = (entryPoint: string) =>
              device.createComputePipeline({
                layout: pipelineLayout,
                compute: { module, entryPoint },
              });
            return { main: pipeline('main'), drawn: pipeline('drawn') };
          }),
      );
    return programs.get(key)!;
  };
  // What the deferred program binds where a frame brings nothing of its own.
  const standIns = new Map<number, GPUBindingResource>([
    [5, { buffer: view.buffer }],
    [CONTRACT_VSM_BINDINGS.pageTable, { buffer: placeholders.vsmPageTable }],
    [CONTRACT_VSM_BINDINGS.projectionData, { buffer: placeholders.vsmProjectionData }],
    [CONTRACT_VSM_BINDINGS.uniforms, { buffer: placeholders.vsmUniforms }],
    [CONTRACT_VSM_BINDINGS.pool, { buffer: placeholders.vsmPool }],
    [RESIDENT_PROXY_BINDING, { buffer: placeholders.proxy }],
    [CONTRACT_SHADOW_BINDINGS.transmittance, placeholders.vsmMask],
    [VSM_MASK_TABLE_BINDING, placeholders.vsmMaskTable.view],
    [VSM_MASK_TILES_BINDING, placeholders.vsmMaskTiles],
    [VSM_TRANSMISSION_RESOLVE_BINDING, placeholders.transmittanceView],
  ]);
  const runs: Record<string, number[]>[] = [];
  for (const scene of scenes) {
    const store = createSceneLightStore();
    for (const light of scene.lights) store.add(light);
    for (const [slot, slice] of scene.slots ?? []) store.assignSlice(slot, slice);
    const lights = createWebgpuLightState(store);
    lights.buffer = createSceneLightContractBuffer(device, store);
    uploadSceneLights(device, lights);
    // One tile: the view is one tile wide and high, every sample at its pixel, at its rank.
    const direct = [scene.lights.length, 1, 1, ...ZERO_DIRECT.slice(3)];
    view.write(new Float32Array(16), [0, 0, 0, 1], 16, 16, 0, false, direct, scene.rank ?? 0);
    const samples = storage(new Float32Array(scene.samples));
    const count = scene.samples.length / SAMPLE_FLOATS;
    const sums: Record<string, number[]> = {};
    for (const record of scene.records) {
      const pipeline = (await programOf(record))?.[record.drawn ? 'drawn' : 'main'];
      if (!pipeline) continue;
      const tiles = storage(new Uint32Array(record.words));
      const output = storage(new Uint32Array(count * 4), true);
      const own = new Map<number, GPUBindingResource>([
        [6, { buffer: lights.buffer }],
        [7, { buffer: tiles }],
        [SAMPLES_BINDING, { buffer: samples }],
        [SUMS_BINDING, { buffer: output }],
      ]);
      const entries = [
        ...resolveEntries.map(({ binding }) => binding),
        SAMPLES_BINDING,
        SUMS_BINDING,
      ].map((binding) => {
        const resource = own.get(binding) ?? standIns.get(binding);
        if (!resource) throw new Error(`the resolve's binding ${binding} has no resource here`);
        return { binding, resource };
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout, entries }));
      pass.dispatchWorkgroups(Math.ceil(count / 64));
      pass.end();
      device.queue.submit([encoder.finish()]);
      const bits = (await readGpuBuffer(device, output, output.size))!;
      sums[record.name] = [...bits.subarray(0, count * 4)];
      tiles.destroy();
      output.destroy();
    }
    runs.push(sums);
    samples.destroy();
    lights.buffer.destroy();
  }
  placeholders.dispose();
  view.dispose();
  const adapter = (await opened.fermer()).court;
  return { adapter, errors: [...opened.errors, ...compilation], runs };
}
