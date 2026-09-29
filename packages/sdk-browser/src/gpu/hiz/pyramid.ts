import {
  HIZ_BUILD_SIDE,
  HIZ_UNIFORM_BYTES,
  hizBuildPasses,
  hizBuildWords,
  type HizBuildPass,
} from './uniforms.ts';
import { pyramidBytes } from './oracle.ts';
import type { HizPyramid } from './types.ts';

/** Source texels one build workgroup covers per side: each thread reduces a 2 × 2 square. */
const TILE = 2 * HIZ_BUILD_SIDE;

/**
 * The build passes of `count` pyramids, one per `z`, in one compute pass: consecutive dispatches
 * inside a pass already see each other's writes. Pass `i` reads uniform slot `i`.
 */
export function encodeHizPyramid(
  encoder: GPUCommandEncoder,
  label: string,
  bindGroup: GPUBindGroup,
  buildPipeline: GPUComputePipeline,
  passes: HizBuildPass[],
  count = 1,
) {
  const pass = encoder.beginComputePass({ label });
  pass.setPipeline(buildPipeline);
  for (let i = 0; i < passes.length; i++) {
    pass.setBindGroup(0, bindGroup, [i * HIZ_UNIFORM_BYTES]);
    pass.dispatchWorkgroups(
      Math.ceil(passes[i].width / TILE),
      Math.ceil(passes[i].height / TILE),
      count,
    );
  }
  pass.end();
}

/**
 * The build and the test of a pyramid over the `width × height` drawn in its level 0: its passes,
 * their uniform words and its mips with their offset and width, a function of that size alone.
 * The packed mips of a smaller size fit in the buffer of a larger one.
 */
export function pyramidLayout(width: number, height: number) {
  const { sizes, offsets } = pyramidBytes(width, height),
    passes = hizBuildPasses(sizes);
  return {
    width,
    height,
    passes,
    words: hizBuildWords(sizes, offsets, passes),
    levels: sizes.map((size, level) => ({ offset: offsets[level], width: size[0] })),
  };
}

export type Pyramid = HizPyramid & {
  level0: GPUTexture;
  level0View: GPUTextureView;
  pyramid: GPUBuffer;
  /** What this image draws in level 0 (`GpuHiz.extent`): the whole size until an image says. */
  drawn: ReturnType<typeof pyramidLayout>;
  /** Its bind group, and the `attach` generation it was made for. */
  group?: GPUBindGroup;
  bindings?: number;
};

/** One view's pyramid at `width × height`: its level 0 and its packed mips. */
export function allocPyramid(
  device: GPUDevice,
  usage: number,
  width: number,
  height: number,
): Pyramid {
  const level0 = device.createTexture({ size: { width, height }, format: 'r32float', usage });
  const pyramid = device.createBuffer({
    size: pyramidBytes(width, height).bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  return {
    width,
    height,
    level0,
    level0View: level0.createView(),
    pyramid,
    drawn: pyramidLayout(width, height),
    destroy() {
      level0.destroy();
      pyramid.destroy();
    },
  };
}
