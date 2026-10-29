import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { RENDER_CURVE_COUNTER, RENDER_CURVE_PARAMS_WGSL } from './paramsWgsl.ts'

/**
 * THE COUNT OF THE VISIBLE CLUSTERS the binners read: the cluster cull's count, held to the room of the visible clusters (the cull
 * counts every cluster it keeps, whether the list had room or not). One invocation. Group 0: the shared block (0), the counters (1).
 * No device dispatches a mesh shader from the arguments the reference also writes here, so only the count is made.
 */
export const RENDER_CURVE_INDIRECT_ARGS_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> curve:RenderCurveParams;
@group(0) @binding(1) var<storage,read_write> counters:array<atomic<u32>>;
@compute @workgroup_size(1)
fn indirectArgs(){
 atomicStore(&counters[${RENDER_CURVE_COUNTER.visibleClusters}],min(atomicLoad(&counters[${RENDER_CURVE_COUNTER.clusterCount}]),curve.maxVisibleClusters));
}`,
  [RENDER_CURVE_PARAMS_WGSL],
)
