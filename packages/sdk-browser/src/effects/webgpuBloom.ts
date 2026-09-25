import type { Bloom } from '../../../sdk-core/src/world/effect/bloom.ts';
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { makeFullscreenPipeline } from '../lighting/deferred/program.ts';
import { bloomBlend, bloomLevelBytes, bloomLevelSizes } from './bloomFilter.ts';
import { BLOOM_UNIFORM_BYTES, BLOOM_UNIFORM_STRIDE, BLOOM_WGSL } from './bloomWgsl.ts';

/** Label of every bloom pass: where it shows in a GPU capture. */
export const BLOOM_PASS = 'Trillion3D bloom';
const FORMAT: GPUTextureFormat = 'rgba16float';
type Size = readonly [number, number];

function createLayouts(device: GPUDevice) {
  const FRAGMENT = GPUShaderStage.FRAGMENT;
  const level = device.createBindGroupLayout({
    label: `${BLOOM_PASS} level`,
    entries: [
      { binding: 0, visibility: FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: FRAGMENT, sampler: { type: 'filtering' } },
      {
        binding: 2,
        visibility: FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: BLOOM_UNIFORM_BYTES },
      },
    ],
  });
  const scene = device.createBindGroupLayout({
    label: `${BLOOM_PASS} scene`,
    entries: [{ binding: 0, visibility: FRAGMENT, texture: { sampleType: 'unfilterable-float' } }],
  });
  return { level, scene };
}

/**
 * The WebGPU bloom (`bloomFilter.ts`): one `rgba16float` texture whose mip levels are the chain,
 * sized with the image (`resize`), and three programs. `encode` writes, into `output`, the image
 * `input` with its glow: the levels are filtered down, summed back up, and the first blended in.
 * Bind groups follow the targets and the two history views the input alternates between: none is
 * made per frame. The uniform is written only when the size or a setting changed.
 */
export async function createWebgpuBloom(device: GPUDevice) {
  const layouts = createLayouts(device);
  const module = await createCheckedShaderModule(device, BLOOM_WGSL, BLOOM_PASS);
  const add: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
  const [down, up, composite] = await Promise.all([
    makeFullscreenPipeline(device, module, layouts.level, 'down', [{ format: FORMAT }]),
    makeFullscreenPipeline(device, module, layouts.level, 'up', [
      { format: FORMAT, blend: { color: add, alpha: add } },
    ]),
    makeFullscreenPipeline(device, module, [layouts.level, layouts.scene], 'composite', [
      { format: FORMAT },
    ]),
  ]);
  const sampler = device.createSampler({
    label: `${BLOOM_PASS} sampler`,
    magFilter: 'linear',
    minFilter: 'linear',
  }); // clamped to the edge, the default address mode
  let texture: GPUTexture | undefined,
    uniform: GPUBuffer | undefined,
    sizes: Size[] = [],
    views: GPUTextureView[] = [],
    groups: GPUBindGroup[] = [],
    inputs = new WeakMap<GPUTextureView, { level: GPUBindGroup; scene: GPUBindGroup }>(),
    packed = new Float32Array(0),
    width = 0,
    height = 0,
    dirty = false;
  const levelGroup = (view: GPUTextureView) =>
    device.createBindGroup({
      layout: layouts.level,
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniform!, size: BLOOM_UNIFORM_BYTES } },
      ],
    });
  const inputGroups = (view: GPUTextureView) => {
    let bound = inputs.get(view);
    if (!bound) {
      const scene = device.createBindGroup({
        layout: layouts.scene,
        entries: [{ binding: 0, resource: view }],
      });
      inputs.set(view, (bound = { level: levelGroup(view), scene }));
    }
    return bound;
  };
  const release = () => {
    texture?.destroy();
    uniform?.destroy();
    texture = uniform = undefined;
    sizes = [];
    views = [];
    groups = [];
    inputs = new WeakMap();
    width = height = 0;
  };
  const put = (at: number, value: number) => {
    dirty ||= packed[at] !== Math.fround(value);
    packed[at] = value;
  };
  /** Writes one uniform slot — inverse sizes written and read, radius, blend — and notes a change. */
  const slot = (index: number, out: Size, read: Size, radius: number, keep = 0, glow = 0) => {
    const base = (index * BLOOM_UNIFORM_STRIDE) / 4;
    put(base, 1 / out[0]);
    put(base + 1, 1 / out[1]);
    put(base + 2, 1 / read[0]);
    put(base + 3, 1 / read[1]);
    put(base + 4, radius);
    put(base + 5, keep);
    put(base + 6, glow);
  };
  const draw = (
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    pipeline: GPURenderPipeline,
    group: GPUBindGroup,
    uniformSlot: number,
    scene?: GPUBindGroup,
  ) => {
    const loadOp = pipeline === up ? 'load' : 'clear';
    const pass = encoder.beginRenderPass({
      label: BLOOM_PASS,
      colorAttachments: [{ view, loadOp, storeOp: 'store', clearValue: [0, 0, 0, 0] }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group, [uniformSlot * BLOOM_UNIFORM_STRIDE]);
    if (scene) pass.setBindGroup(1, scene);
    pass.draw(3);
    pass.end();
  };
  return {
    /** Bytes of the level chain as allocated; zero before the first `resize`. */
    get bytes() {
      return texture ? bloomLevelBytes(width, height) : 0;
    },
    /** Levels of the chain at the current size; zero on an image too small to halve. */
    get levels() {
      return sizes.length;
    },
    /** Sizes the chain for an image; true when it was reallocated. */
    resize(nextWidth: number, nextHeight: number) {
      if (nextWidth === width && nextHeight === height) return false;
      release();
      width = nextWidth;
      height = nextHeight;
      sizes = bloomLevelSizes(width, height);
      if (!sizes.length) return true;
      texture = device.createTexture({
        label: `${BLOOM_PASS} levels`,
        size: { width: sizes[0][0], height: sizes[0][1] },
        mipLevelCount: sizes.length,
        format: FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      uniform = device.createBuffer({
        label: `${BLOOM_PASS} uniform`,
        size: sizes.length * 2 * BLOOM_UNIFORM_STRIDE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      packed = new Float32Array(uniform.size / 4).fill(Number.NaN);
      views = sizes.map((_, level) =>
        texture!.createView({ baseMipLevel: level, mipLevelCount: 1 }),
      );
      groups = views.map(levelGroup);
      return true;
    },
    /** Draws `input` and its glow into `output`: 2 × levels passes. The chain must be sized. */
    encode(
      encoder: GPUCommandEncoder,
      bloom: Bloom,
      input: GPUTextureView,
      output: GPUTextureView,
    ) {
      const count = sizes.length;
      const full: Size = [width, height],
        { keep, glow } = bloomBlend(bloom.intensity, count),
        { radius } = bloom;
      for (let level = 0; level < count; level++)
        slot(level, sizes[level], level ? sizes[level - 1] : full, radius);
      for (let level = 0; level + 1 < count; level++)
        slot(count + level, sizes[level], sizes[level + 1], radius);
      slot(2 * count - 1, full, sizes[0], radius, keep, glow);
      if (dirty) device.queue.writeBuffer(uniform!, 0, packed);
      dirty = false;
      const source = inputGroups(input);
      for (let level = 0; level < count; level++)
        draw(encoder, views[level], down, level ? groups[level - 1] : source.level, level);
      for (let level = count - 2; level >= 0; level--)
        draw(encoder, views[level], up, groups[level + 1], count + level);
      draw(encoder, output, composite, groups[0], 2 * count - 1, source.scene);
      return 2 * count;
    },
    dispose() {
      release();
    },
  };
}

export type WebgpuBloom = Awaited<ReturnType<typeof createWebgpuBloom>>;
