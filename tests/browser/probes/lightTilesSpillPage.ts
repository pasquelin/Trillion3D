/**
 * Page side of the spill probe (#849): each case runs the shipped compaction
 * (`lightTilesSpillHarness.ts`) on one workgroup of a real device, with the engine's light buffer
 * and its pool state, and returns the tile record with its pool words and the pool's state, read
 * back word for word.
 */
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts';
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import { KEEPS_BINDING, spillHarness, type SpillCase } from './lightTilesSpillHarness.ts';
import { ouvrirAppareil } from './webgpuDevice.ts';
import { tileLayout } from '../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';

/** A storage buffer holding `words`, one word at least: a case of no light binds one too. */
const storage = (device: GPUDevice, words: ArrayLike<number>) => {
  const data = new Uint32Array(Math.max(words.length, 1));
  data.set(words);
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
};

export async function run(cases: SpillCase[]) {
  const opened = await ouvrirAppareil();
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const;
  const { device } = opened;
  // Light `k` at x = k: the harness's slice test reads its keeps by that coordinate.
  const store = createSceneLightStore();
  const most = Math.max(1, ...cases.map((c) => c.count));
  for (let k = 0; k < most; k++)
    store.add({
      id: `l${k}`,
      kind: 'point',
      position: [k, 0, 0],
      color: [1, 1, 1],
      intensity: 1,
      range: 1,
      castsShadow: false,
    });
  const lights = {
    store,
    buffer: createSceneLightContractBuffer(device, store),
    uploadedEpoch: -1,
  };
  uploadSceneLights(device, lights as Parameters<typeof uploadSceneLights>[1]);
  const compilation: string[] = [];
  const runs = [];
  // Two shaders serve every case, the narrow pass's and the wide one's: each is compiled once.
  const shapes = new Map<string, { pipeline: GPUComputePipeline; stride: number } | undefined>();
  for (const c of cases) {
    const shape = `${c.words}/${c.pool}`;
    if (!shapes.has(shape)) {
      const code = spillHarness(c.words, c.pool);
      const { module, compilation: errors } = await opened.compile(code);
      compilation.push(...errors.map((error) => `${shape}: ${error}`));
      shapes.set(
        shape,
        errors.length
          ? undefined
          : {
              pipeline: device.createComputePipeline({
                layout: 'auto',
                compute: { module, entryPoint: 'main' },
              }),
              // Words of a tile record, the pool after it: the harness's `TILE_STRIDE`.
              stride: tileLayout(code).stride,
            },
      );
    }
    const compiled = shapes.get(shape);
    if (!compiled) continue;
    const { pipeline, stride } = compiled;
    const view = new Uint32Array(8);
    view[4] = c.count;
    const uniform = device.createBuffer({
      size: view.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniform, 0, view);
    const tiles = storage(device, new Uint32Array(stride + c.capacity));
    const keeps = storage(device, c.keeps);
    const pool = storage(device, [stride, c.capacity, c.head, 0]);
    const entries: GPUBindGroupEntry[] = [
      { binding: 1, resource: { buffer: uniform } },
      { binding: 2, resource: { buffer: lights.buffer } },
      { binding: 3, resource: { buffer: tiles } },
      { binding: KEEPS_BINDING, resource: { buffer: keeps } },
    ];
    if (c.pool) entries.push({ binding: 4, resource: { buffer: pool } });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }),
    );
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const words = await readGpuBuffer(device, tiles, tiles.size);
    const state = await readGpuBuffer(device, pool, pool.size);
    runs.push({ name: c.name, tiles: [...words!], pool: [...state!] });
    for (const buffer of [uniform, tiles, keeps, pool]) buffer.destroy();
  }
  lights.buffer.destroy();
  const adapter = (await opened.fermer()).court;
  return { adapter, errors: [...opened.erreurs, ...compilation], runs };
}
