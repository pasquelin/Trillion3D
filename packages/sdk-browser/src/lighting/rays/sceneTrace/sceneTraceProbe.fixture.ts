import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { sceneTraceLayoutEntries, sceneTraceWgsl } from './sceneTraceWgsl.ts'

/** Where the probe binds the scene trace (`sceneTraceWgsl`): its group, and its first binding. */
export const PROBE_GROUP = 1,
  PROBE_FIRST = 0

/**
 * A program that casts the scene trace's one ray (the nearest hit, its normal in the world), from the eye
 * along +x, and writes the hit as floats and words: what the library's text is compiled as, beside the cut's
 * tables it lists in group 0, before any consumer exists. The result is the last binding of the group.
 */
export const SCENE_TRACE_PROBE = wgslProgram(
  `@group(${PROBE_GROUP}) @binding(${PROBE_FIRST + sceneTraceLayoutEntries(PROBE_FIRST).length}) var<storage,read_write> traced:array<f32>;
@compute @workgroup_size(1) fn traceProbe(){
 let hit=stTrace(StRay(vec3f(0.0),vec3f(1.0,0.0,0.0),0.0,1.0e4,0u));
 traced[0]=hit.distance;
 traced[1]=bitcast<f32>(hit.placement);
 traced[2]=bitcast<f32>(hit.record);
 traced[3]=bitcast<f32>(hit.triangle);
 traced[4]=hit.normal.x;
 traced[5]=hit.normal.y;
 traced[6]=hit.normal.z;
 traced[7]=f32(u32(hit.frontFace)|(u32(hit.twoSided)<<1u)|(u32(hit.hit)<<2u)|(u32(stComplete)<<3u));
}`,
  [sceneTraceWgsl(PROBE_GROUP, PROBE_FIRST)],
)
