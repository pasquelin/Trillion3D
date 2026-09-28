/**
 * Page side of the plain light-tile probe (#924): the engine's tile pass (`createGpuLightTiles`)
 * built twice on one device that granted `subgroups` — once as granted, which compiles the
 * subgroup variant, once through a view of the device that reports no `subgroups`, which compiles
 * the plain one every other device runs. Same depth, same lights, same view: the tile lists read
 * back from both, decoded tile by tile (the pool's slices land where each run's atomics put them).
 */
import { LIGHT_SETTINGS, createSceneLightStore } from '../../../packages/sdk-core/src/index.ts';
import { createGpuLightTiles } from '../../../packages/sdk-browser/src/lighting/tiles/tiles.ts';
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts';
import { TILE_STRIDE_WORDS } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts';
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts';
import {
  NEAR,
  camera,
  pixelPoint,
} from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { ouvrirAppareil } from './webgpuDevice.ts';

const [WIDTH, HEIGHT] = [333, 207]; // cut tiles on both axes
const view = camera([3, 40, -5], 0.8, -0.6, 70, WIDTH, HEIGHT);

/** The ground y = 0 under each pixel, some pixels on nearer objects, some on the sky (0). */
function depthField(r: () => number) {
  const depths = new Float32Array(WIDTH * HEIGHT);
  for (let py = 0; py < HEIGHT; py++)
    for (let px = 0; px < WIDTH; px++) {
      const near = pixelPoint(view, px, py, 1),
        far = pixelPoint(view, px, py, NEAR / 1e5);
      const t = near[1] / (near[1] - far[1]);
      const ground = t > 0 && t < 1 && r() > 0.03 ? NEAR / (NEAR + t * (1e5 - NEAR)) : 0;
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

/** A tile list, decoded: the light indices, or `all` where the pool had no room. */
function decode(words: Uint32Array, tiles: number) {
  const lists: (number[] | 'all')[] = [];
  for (let tile = 0; tile < tiles; tile++)
    for (const slot of [0, 1]) {
      const base = tile * TILE_STRIDE_WORDS,
        kept = words[base + slot],
        first = base + 2 + slot * LIGHT_SETTINGS.tileLights;
      if (kept <= LIGHT_SETTINGS.tileLights) lists.push([...words.subarray(first, first + kept)]);
      else if (words[first] === 0xffffffff) lists.push('all');
      else lists.push([...words.subarray(words[first], words[first] + kept)]);
    }
  return lists;
}

export async function executer(lightCounts: number[]) {
  const appareil = await ouvrirAppareil(['subgroups']);
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  if (!device.features.has('subgroups')) {
    await appareil.fermer();
    return { indisponible: 'the adapter offers no subgroups' };
  }
  // The device as a device without `subgroups` sees it; every buffer readable back.
  const seenAs = (plain: boolean) =>
    new Proxy(device, {
      get: (target, key) => {
        if (key === 'features' && plain)
          return { has: (name: string) => name !== 'subgroups' && target.features.has(name) };
        if (key === 'createBuffer')
          return (d: GPUBufferDescriptor) =>
            target.createBuffer({ ...d, usage: d.usage | GPUBufferUsage.COPY_SRC });
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const r = random(924);
  const depths = depthField(r);
  const depth = depthTexture(device, depths).createView();
  const runs = [];
  for (const count of lightCounts) {
    const store = sceneLights(r, depths, count);
    const lights = {
      store,
      buffer: createSceneLightContractBuffer(device, store),
      uploadedEpoch: -1,
    };
    uploadSceneLights(device, lights as Parameters<typeof uploadSceneLights>[1]);
    const lists = [];
    for (const plain of [false, true]) {
      const tiles = await createGpuLightTiles(seenAs(plain));
      tiles.ensure(WIDTH, HEIGHT, depth, lights.buffer, count);
      tiles.update(view.viewProjection, view.eye, WIDTH, HEIGHT);
      const readback = device.createBuffer({
        size: tiles.buffer!.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      tiles.encode(encoder, 1);
      encoder.copyBufferToBuffer(tiles.buffer!, 0, readback, 0, readback.size);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const words = new Uint32Array(readback.getMappedRange().slice(0));
      readback.destroy();
      lists.push({
        subgroups: tiles.subgroups,
        wide: tiles.wide,
        lists: decode(words, tiles.tilesX * tiles.tilesY),
      });
      tiles.dispose();
    }
    lights.buffer.destroy();
    runs.push({ count, subgroup: lists[0], plain: lists[1] });
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, erreurs, runs };
}
