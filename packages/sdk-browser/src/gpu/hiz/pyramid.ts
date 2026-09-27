import { HIZ_BUILD_SIDE, type HizBuildPass } from './uniforms.ts';

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
  sizes: Array<[number, number]>,
  passes: HizBuildPass[],
  uniformBytes: number,
  count = 1,
) {
  const pass = encoder.beginComputePass({ label });
  pass.setPipeline(buildPipeline);
  passes.forEach(({ source }, i) => {
    const [width, height] = sizes[source];
    pass.setBindGroup(0, bindGroup, [i * uniformBytes]);
    pass.dispatchWorkgroups(Math.ceil(width / TILE), Math.ceil(height / TILE), count);
  });
  pass.end();
}
