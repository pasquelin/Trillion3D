import { HIZ_BUILD_SIDE, HIZ_UNIFORM_BYTES, type HizBuildPass } from './uniforms.ts';

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
