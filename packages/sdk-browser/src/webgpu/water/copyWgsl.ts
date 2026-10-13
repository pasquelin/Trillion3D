import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { HDR_FORMAT } from '../../scene/surfaceBuffer.ts'
import { VERDICT_WGSL } from '../blend/verdictLayout.ts'
import { WATER_COPY_TILE } from './argsWgsl.ts'

/** The lit image's texels within the backdrop copy the GPU wrote (`argsWgsl.ts`), each stored as
 *  it was loaded: a half-float widened to single precision and narrowed back, the same bits. */
export const WATER_COPY_SHADER = wgslProgram(
  `@group(0) @binding(0) var lit:texture_2d<f32>;
@group(0) @binding(1) var backdrop:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(2) var<storage,read> verdict:array<u32>;
@compute @workgroup_size(${WATER_COPY_TILE},${WATER_COPY_TILE})
fn copyBackdrop(@builtin(global_invocation_id) id:vec3u){
 let size=vec2u(verdict[VERDICT_COPY+2u],verdict[VERDICT_COPY+3u]);
 if(any(id.xy>=size)){return;}
 let at=vec2u(verdict[VERDICT_COPY],verdict[VERDICT_COPY+1u])+id.xy;
 textureStore(backdrop,at,textureLoad(lit,at,0));
}`,
  [VERDICT_WGSL],
)
