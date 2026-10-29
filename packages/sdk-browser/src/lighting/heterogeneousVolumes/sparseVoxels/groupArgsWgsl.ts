import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'

/**
 * THE DISPATCH OF A LIST from its counter: one group of 64 threads for each 64 entries, in rows of 32768 groups, so that a list past 4194304
 * entries stays under the limit of a dimension. Bindings: 0 the counter (read), 1 the arguments (storage, three words).
 */
export const SV_GROUP_ARGS_WGSL = wgslProgram(
  `@group(0) @binding(0) var<storage,read> counter:array<u32>;
@group(0) @binding(1) var<storage,read_write> args:array<u32>;
@compute @workgroup_size(1)
fn groupArgs(){
 let groups=(counter[0]+63u)/64u;
 let width=min(max(groups,1u),32768u);
 args[0]=width;
 args[1]=max((groups+width-1u)/width,1u);
 args[2]=1u;
}`,
  [],
)
