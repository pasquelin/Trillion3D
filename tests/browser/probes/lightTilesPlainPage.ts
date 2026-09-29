/**
 * Page side of the plain light-tile probe (#924): the engine's tile pass (`createGpuLightTiles`)
 * built on two devices of one adapter — one that granted `subgroups`, which compiles the subgroup
 * variant, and one opened without it, which compiles the plain one every other device runs. Same
 * depth, same lights, same view: the tile lists read back from both, decoded tile by tile as the
 * resolve walks them (the pool's slices land where each run's atomics put them).
 */
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts';
import { createGpuLightTiles } from '../../../packages/sdk-browser/src/lighting/tiles/tiles.ts';
import { LIGHT_TILES_SHADER } from '../../../packages/sdk-browser/src/lighting/tiles/shader.ts';
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import { seeded } from '../../../site/examples/kit/random.ts';
import {
  camera,
  pixelPoint,
  pixelRay,
  rayDepth,
} from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { tileLayout, tileLists } from '../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';
import { ouvrirAppareil } from './webgpuDevice.ts';

const [WIDTH, HEIGHT] = [333, 207]; // cut tiles on both axes
const view = camera([3, 40, -5], 0.8, -0.6, 70, WIDTH, HEIGHT);

/** The ground y = 0 under each pixel, some pixels on nearer objects, some on the sky (0). */
function depthField(r: () => number) {
  const depths = new Float32Array(WIDTH * HEIGHT);
  for (let py = 0; py < HEIGHT; py++)
    for (let px = 0; px < WIDTH; px++) {
      const { o, d } = pixelRay(view, px, py);
      const t = d[1] < 0 ? -o[1] / d[1] : Infinity;
      const ground = t < 1 && r() > 0.03 ? rayDepth(t) : 0;
      depths[py * WIDTH + px] =
        ground && r() < 0.05 ? Math.min(1, ground / (0.2 + 0.8 * r())) : ground;
    }
  return depths;
}

/** The depth texture the pass reads, drawn from `depths` by one full-screen triangle. */
function depthTexture(device: GPUDevice, depths: Float32Array<ArrayBuffer>) {
  const source = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture: source }, depths, { bytesPerRow: WIDTH * 4 }, [
    WIDTH,
    HEIGHT,
  ]);
  const depth = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const module = device.createShaderModule({
    code: `@group(0) @binding(0) var source:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 return vec4f(f32(i&1u)*4.0-1.0,f32(i>>1u)*4.0-1.0,0.0,1.0);}
@fragment fn fs(@builtin(position) at:vec4f)->@builtin(frag_depth) f32{
 return textureLoad(source,vec2i(at.xy),0).r;}`,
  });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module },
    fragment: { module, targets: [] },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'always' },
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [],
    depthStencilAttachment: {
      view: depth.createView(),
      depthClearValue: 0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: source.createView() }],
    }),
  );
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
  return depth;
}

/** `count` point lights around the pixels' points; an eighth of them in a tight cluster, so the
 *  tiles under it keep more lights than a list and the wide pass spills into its pool. */
function sceneLights(r: () => number, depths: Float32Array, count: number) {
  const store = createSceneLightStore();
  const pointOf = () => {
    let at = Math.floor(r() * depths.length);
    while (!depths[at]) at = Math.floor(r() * depths.length);
    return pixelPoint(view, at % WIDTH, Math.floor(at / WIDTH), depths[at]);
  };
  const anchor = pointOf();
  for (let k = 0; k < count; k++) {
    const cluster = k < count / 8;
    const range = cluster ? 4 : Math.exp(Math.log(0.05) + r() * Math.log(600));
    const [centre, reach] = cluster ? [anchor, 1] : [pointOf(), 2 * range];
    const position = centre.map((v) => v + (r() * 2 - 1) * r() * reach) as typeof centre;
    store.add({
      id: `l${k}`,
      kind: 'point',
      position,
      color: [1, 1, 1],
      intensity: 1,
      range,
      castsShadow: false,
    });
  }
  return store;
}

const LAYOUT = tileLayout(LIGHT_TILES_SHADER);

/** One device's pass over the probe's depth, per light count: whether it compiled the subgroup
 *  variant, whether it ran wide, and each tile's opaque and blend lists as the resolve walks
 *  them; `overflowed` counts the tiles whose pool had no room (they walk every light). */
async function tileListsOn(
  features: GPUFeatureName[],
  depths: Float32Array<ArrayBuffer>,
  counts: number[],
) {
  const opened = await ouvrirAppareil(features);
  if (!opened) return { unavailable: 'no WebGPU adapter' } as const;
  const { device } = opened;
  const depth = depthTexture(device, depths).createView();
  const tiles = await createGpuLightTiles(device);
  const r = seeded(924);
  const runs = [];
  for (const count of counts) {
    const store = sceneLights(r, depths, count);
    const lights = {
      store,
      buffer: createSceneLightContractBuffer(device, store),
      uploadedEpoch: -1,
    };
    uploadSceneLights(device, lights as Parameters<typeof uploadSceneLights>[1]);
    tiles.ensure(WIDTH, HEIGHT, depth, lights.buffer, count);
    tiles.update(view.viewProjection, view.eye, WIDTH, HEIGHT);
    const encoder = device.createCommandEncoder();
    tiles.encode(encoder, 1);
    device.queue.submit([encoder.finish()]);
    const words = (await readGpuBuffer(device, tiles.buffer!, tiles.buffer!.size))!;
    const lists = [];
    let overflowed = 0;
    for (let tile = 0; tile < tiles.tilesX * tiles.tilesY; tile++) {
      const record = tile * LAYOUT.stride;
      for (const [slot, base] of [
        [0, LAYOUT.opaqueBase],
        [1, LAYOUT.blendBase],
      ])
        overflowed += +(
          words[record + slot] > LAYOUT.tileLights && words[record + base] === LAYOUT.noSlice
        );
      const { opaque, blend } = tileLists(LAYOUT, words, count, record);
      lists.push(opaque, blend);
    }
    lights.buffer.destroy();
    runs.push({ count, subgroups: tiles.subgroups, wide: tiles.wide, overflowed, lists });
  }
  tiles.dispose();
  const granted = device.features.has('subgroups');
  const errors = opened.erreurs;
  return { adapter: (await opened.fermer()).court, granted, errors, runs };
}

export async function run(lightCounts: number[]) {
  const depths = depthField(seeded(923));
  const subgroup = await tileListsOn(['subgroups'], depths, lightCounts);
  if (subgroup.unavailable) return { unavailable: subgroup.unavailable };
  if (!subgroup.granted) return { unavailable: 'the adapter offers no subgroups' };
  const plain = await tileListsOn([], depths, lightCounts);
  if (plain.unavailable) return { unavailable: plain.unavailable };
  return {
    adapter: subgroup.adapter,
    errors: [...subgroup.errors, ...plain.errors],
    runs: subgroup.runs.map((run, k) => ({
      count: run.count,
      subgroup: run,
      plain: plain.runs[k],
    })),
  };
}
