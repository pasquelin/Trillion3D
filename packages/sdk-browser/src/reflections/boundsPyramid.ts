import { oncePerDevice } from '../gpu/core/oncePerDevice.ts';
import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts';
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { buildComputePipeline } from '../lighting/deferred/fullscreen.ts';
import { levelViews, reductionGroups } from '../texture/mipBatch.ts';
import { levelSize } from '../texture/tiles.ts';
import { REFLECTION_BOUNDS_MIPS_PASS } from '../texture/mipsPass.ts';
import {
  BOUNDS_WORKGROUP,
  REFLECTION_BOUNDS_DEPTH_WGSL,
  REFLECTION_BOUNDS_LEVEL_WGSL,
} from './boundsPyramidWgsl.ts';

/** A reduction's bindings: its source — the depth for level 0, else the level below —, its
 *  extents, and the level it writes. */
const boundsLayout = (device: GPUDevice, sampleType: GPUTextureSampleType) =>
  device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rg32float' },
      },
    ],
  });
const layoutsOf = oncePerDevice((device) => ({
  fromDepth: boundsLayout(device, 'depth'),
  fromLevel: boundsLayout(device, 'unfilterable-float'),
}));
/** Built on the device itself (`sharedGpuDevice`), never on a session's handle: every session of
 *  the device shares them, as the texture chains' programs (`../texture/mips.ts`). */
const boundsLayouts = (device: GPUDevice) => layoutsOf(sharedGpuDevice(device));

/** The two reductions, compiled once a device, off the thread, with the reflection's other
 *  programs (`pipelines.ts`): no image compiles them. */
export const reflectionBoundsPipelines = (device: GPUDevice) =>
  pipelinesOf(sharedGpuDevice(device));
const pipelinesOf = oncePerDevice(async (device) => {
  const layouts = boundsLayouts(device);
  const stage = async (module: Promise<GPUShaderModule>, layout: GPUBindGroupLayout) =>
    buildComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: await module, entryPoint: 'reduceBounds' },
    });
  const [fromDepth, fromLevel] = await Promise.all([
    stage(
      createCheckedShaderModule(device, REFLECTION_BOUNDS_DEPTH_WGSL, 'REFLECTION_BOUNDS_DEPTH'),
      layouts.fromDepth,
    ),
    stage(
      createCheckedShaderModule(device, REFLECTION_BOUNDS_LEVEL_WGSL, 'REFLECTION_BOUNDS_LEVEL'),
      layouts.fromLevel,
    ),
  ]);
  return { fromDepth, fromLevel };
});
export type ReflectionBoundsPipelines = Awaited<ReturnType<typeof pipelinesOf>>;

/** The pass's descriptor, the same object every image. */
const BOUNDS_PASS: GPUComputePassDescriptor = { label: REFLECTION_BOUNDS_MIPS_PASS };

/**
 * The nearest/farthest pyramid over the depth target `depth` (`width × height`), in the levels of
 * `texture`, half its size: ONE compute pass, a dispatch per level, each level reduced from the
 * one below (`boundsPyramidWgsl.ts`). A frame source keeps its views, groups and workgroup counts;
 * encoding never allocates. Its owner admits the uniform buffer (`reflectionConeAllocation`).
 */
export function createReflectionBoundsPyramid(
  device: GPUDevice,
  texture: GPUTexture,
  depth: { view: GPUTextureView; width: number; height: number },
) {
  const { width, height } = depth;
  const layouts = boundsLayouts(device);
  const views = levelViews(texture);
  const { uniforms, groups } = reductionGroups(
    device,
    'Trillion3D reflection depth bounds extents',
    [width, height],
    views.length,
    (index, extent) =>
      device.createBindGroup({
        layout: index ? layouts.fromLevel : layouts.fromDepth,
        entries: [
          { binding: 0, resource: index ? views[index - 1] : depth.view },
          { binding: 1, resource: extent },
          { binding: 2, resource: views[index] },
        ],
      }),
  );
  // Level `index` is source level `index + 1`'s size: its threads, by workgroup.
  const workgroups = views.map((_, index) =>
    levelSize(width, height, index + 1).map((side) => Math.ceil(side / BOUNDS_WORKGROUP)),
  );
  return {
    encode(encoder: GPUCommandEncoder, pipelines: ReflectionBoundsPipelines) {
      const pass = encoder.beginComputePass(BOUNDS_PASS);
      pass.setPipeline(pipelines.fromDepth);
      for (let index = 0; index < groups.length; index++) {
        if (index === 1) pass.setPipeline(pipelines.fromLevel);
        pass.setBindGroup(0, groups[index]);
        pass.dispatchWorkgroups(workgroups[index][0], workgroups[index][1]);
      }
      pass.end();
    },
    dispose() {
      uniforms.destroy();
    },
  };
}
