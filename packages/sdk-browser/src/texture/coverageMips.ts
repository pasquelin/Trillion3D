import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts';
import { COVERAGE_WGSL } from './mipsWgsl.ts';
import { levelSize } from './tiles.ts';
import { TEXTURE_COVERAGE_PASS } from './coveragePass.ts';
import { preparedComputePipeline, type PreparedPipeline } from '../lighting/deferred/fullscreen.ts';

/** Bytes of one level's 256 bins. */
export const LEVEL_BIN_BYTES = 1024;

type CoverageProgram = {
  layout: GPUBindGroupLayout;
  count: PreparedPipeline<GPUComputePipeline>;
  pick: PreparedPipeline<GPUComputePipeline>;
};
const programs = new WeakMap<GPUDevice, CoverageProgram>();

/** The counts' program, built once per device — the shared one (`sharedGpuDevice`), as the mips'
 *  (`mips.ts`) —, its two pipelines compiled off the thread (`prepareCoveragePipelines`). */
function coverageProgram(device: GPUDevice): CoverageProgram {
  const held = programs.get(device);
  if (held) return held;
  const visibility = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility, texture: { sampleType: 'float' } },
      { binding: 1, visibility, buffer: { type: 'uniform' } },
      { binding: 2, visibility, buffer: { type: 'storage' } },
    ],
  });
  const module = device.createShaderModule({ code: COVERAGE_WGSL }),
    pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipeline = (entryPoint: string) =>
    preparedComputePipeline(device, { layout: pipelineLayout, compute: { module, entryPoint } });
  const built = { layout, count: pipeline('count'), pick: pipeline('choose') };
  programs.set(device, built);
  return built;
}

/** Compiles off the thread, before a colour texture's mips cut its coverage, the counts' two
 *  pipelines on `device`'s shared cache. */
export function prepareCoveragePipelines(device: GPUDevice) {
  const { count, pick } = coverageProgram(sharedGpuDevice(device));
  return Promise.all([count.prepare(), pick.prepare()]).then(() => {});
}

/** What a chain's counts read: its size, its levels' views, the uniform blocks of
 *  `generateMaterialMips`, one per level from block `first`, and the device's bins, cleared. */
export type CoverageChain = {
  width: number;
  height: number;
  views: GPUTextureView[];
  uniforms: GPUBuffer;
  first: number;
  stride: number;
  bins: GPUBuffer;
};

/** Counts level `level` of `chain` (level 0 first, before level 1) and copies its `t` into the
 *  level's uniform block, the one its reduction then scales by. */
export function countCoverage(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  chain: CoverageChain,
  level: number,
) {
  const { layout, count, pick } = coverageProgram(sharedGpuDevice(device));
  const { width, height, views, uniforms, first, stride, bins } = chain;
  const group = (block: number, source: number) =>
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: views[source] },
        { binding: 1, resource: { buffer: uniforms, offset: (first + block) * stride, size: 32 } },
        { binding: 2, resource: { buffer: bins } },
      ],
    });
  const pass = encoder.beginComputePass({ label: TEXTURE_COVERAGE_PASS });
  pass.setPipeline(count.get());
  const dispatch = ([w, h]: [number, number]) =>
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
  if (level === 1) {
    pass.setBindGroup(0, group(0, 0));
    dispatch([width, height]);
  }
  pass.setBindGroup(0, group(level, level - 1));
  dispatch(levelSize(width, height, level));
  pass.setPipeline(pick.get());
  pass.dispatchWorkgroups(1);
  pass.end();
  // `t` lands in the block's fourth word, the `extent.w` its reduction scales by.
  encoder.copyBufferToBuffer(
    bins,
    level * LEVEL_BIN_BYTES,
    uniforms,
    (first + level) * stride + 12,
    4,
  );
}
