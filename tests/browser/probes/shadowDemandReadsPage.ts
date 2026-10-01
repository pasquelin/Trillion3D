/**
 * Page side of `shadow-demand-reads-gpu.ts` (#1275): on a real device, the per-pixel demand's own
 * functions (`demandLight`, `demandWgsl.ts`) and the shading's own read (`shadowFactor`,
 * `directShadowWgsl`) over the points each frame of a scene lights: the pages the demand marks,
 * each then readable — the GPU draws what it maps in the frame (`freshWgsl.ts`) —, and the pages
 * the read asks for. The scheduler's plan lays the records and the table out, as the engine's does.
 */
import { LIGHT_KIND } from '../../../packages/sdk-core/src/index.ts';
import { createSceneLightStore } from '../../../packages/sdk-core/src/scene/light/store.ts';
import { createShadowPlan } from '../../../packages/sdk-core/src/scene/light-shadow/plan.ts';
import { PAGES } from '../../../packages/sdk-core/src/scene/light-shadow/pageModel.ts';
import {
  SHADOW_PAGE,
  SHADOW_TABLE_ENTRIES,
} from '../../../packages/sdk-core/src/scene/light-shadow/virtual.ts';
import { writeShadowRecords } from '../../../packages/sdk-browser/src/webgpu/shadow/pages.ts';
import { createShadowRecordPack } from '../../../packages/sdk-browser/src/gpu/shadow/recordPack.ts';
import { SHADOW_TABLE_OFFSET } from '../../../packages/sdk-browser/src/gpu/shadow/atlas.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts';
import { ASTROLABE, LAMP_RING, type DemandScene } from './shadowDemandScenes.ts';
import { DEMAND, READ } from './shadowDemandReadsWgsl.ts';
import {
  shadowTableStride,
  SUN_WINDOW,
} from '../../../packages/sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowEntryBits } from '../../../packages/sdk-browser/src/webgpu/shadow/allocLayout.ts';

const SHADOW_TABLE_STRIDE = shadowTableStride(SUN_WINDOW);
const SHADOW_REQUEST_BITS = shadowEntryBits();

const MIN = [-50, 0, -50],
  MAX = [50, 10, 50],
  FRAMES = 12,
  /** Pages a side of the atlas the reads sample: any page does, the probe compares requests. */
  ATLAS = 8,
  CAP = 1 << 16;
type Entry = GPUBindGroupEntry['resource'];

/** One scene, frame by frame: the pages marked, and those read that no mark named or that were
 *  marked and not read. */
async function runScene(device: GPUDevice, scene: DemandScene) {
  const store = createSceneLightStore(),
    plan = createShadowPlan(ATLAS),
    pack = createShadowRecordPack(256, ATLAS);
  for (const light of scene.lights(0)) store.add(light);
  const lights = {
    store,
    buffer: createSceneLightContractBuffer(device, store),
    uploadedEpoch: -1,
  };
  const storage = (size: number, usage = 0) =>
    device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | usage });
  const data = storage(SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4),
    requests = storage((1 + CAP + SHADOW_REQUEST_BITS) * 4, GPUBufferUsage.COPY_SRC);
  const texture = (format: GPUTextureFormat, side: number) =>
    device
      .createTexture({ size: [side, side, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView({ dimension: '2d-array' });
  const atlas = texture('depth32float', ATLAS * SHADOW_PAGE),
    tint = texture('rgba8unorm', 1),
    tintDepth = texture('depth32float', 1),
    sampler = device.createSampler({ compare: 'greater' });
  const pipeline = (code: string) =>
    device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
    });
  const [demand, read] = [pipeline(DEMAND), pipeline(READ)];
  const table = new Uint32Array(SHADOW_TABLE_ENTRIES),
    shadows = { writeSun: pack.writeSun, writeLamp: pack.writeLamp, clearRecord: pack.clear };
  /** Runs `on` over the points into zeroed requests; returns the entries they asked for. */
  const ask = async (on: GPUComputePipeline, entries: [number, Entry][], count: number) => {
    const encoder = device.createCommandEncoder();
    encoder.clearBuffer(requests);
    const pass = encoder.beginComputePass();
    pass.setPipeline(on);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: on.getBindGroupLayout(0),
        entries: entries.map(([binding, resource]) => ({ binding, resource })),
      }),
    );
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    device.queue.submit([encoder.finish()]);
    const listed = (await readGpuBuffer(device, requests, (1 + CAP) * 4)) ?? new Uint32Array(1);
    return new Set(listed.slice(1, 1 + Math.min(listed[0], CAP)));
  };
  const frames = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    for (const light of scene.lights(frame)) store.set(light.id, { position: light.position });
    uploadSceneLights(device, lights as never);
    const view = scene.view;
    plan.plan(store, view, MIN, MAX, frame, frame * 16);
    writeShadowRecords({ store, plan, shadows } as never);
    device.queue.writeBuffer(data, 0, pack.records);
    // Each lit point, with the footprint the shading reads it at.
    const points = scene.lits(frame),
      packed = new Float32Array(points.length * 8);
    points.forEach(({ P, N }, i) => {
      const along = P.reduce((s, c, a) => s + (c - view.position[a]) * view.forward[a], 0);
      packed.set([...P, (view.pixelNear * along) / view.near, ...N, 0], i * 8);
    });
    const lits = storage(packed.byteLength);
    device.queue.writeBuffer(lits, 0, packed);
    const lit: Entry = { buffer: lits },
      light: Entry = { buffer: lights.buffer };
    const common: [number, Entry][] = [
      [0, { buffer: data }],
      [1, { buffer: requests }],
    ];
    const marked = await ask(demand, [...common, [2, lit], [3, light]], points.length);
    // Every marked page drawn in the frame: mapped and readable, in the range its sun draws in.
    table.fill(0);
    [...marked].forEach((entry, i) => {
      const slice = Math.floor(entry / SHADOW_TABLE_STRIDE),
        sun = plan.records.kind[slice] === LIGHT_KIND.directional,
        range = sun ? plan.sun.ranges.current[slice] : 0;
      table[entry] = PAGES.shadowReadableWord(i % (ATLAS * ATLAS), range);
    });
    device.queue.writeBuffer(data, SHADOW_TABLE_OFFSET, table);
    const textures: [number, Entry][] = [
      [2, tint],
      [3, tintDepth],
      [4, atlas],
      [5, sampler],
    ];
    const asked = await ask(read, [...common, ...textures, [6, lit], [7, light]], points.length);
    lits.destroy();
    frames.push({
      marked: marked.size,
      unmarked: [...asked].filter((entry) => !marked.has(entry)),
      unread: [...marked].filter((entry) => !asked.has(entry)),
    });
  }
  return { scene: scene.name, frames };
}

/** Both scenes on the page's device; its validation errors, if any. */
export async function run() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { unavailable: 'no WebGPU adapter' } as const;
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  const scenes = [];
  for (const scene of [ASTROLABE, LAMP_RING]) scenes.push(await runScene(device, scene));
  device.destroy();
  return { errors, scenes };
}
