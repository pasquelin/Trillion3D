import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { VERDICT_WGSL } from '../blend/verdictLayout.ts'
import { WATER_COPY_TILE } from './argsWgsl.ts'

/** The copy's bindings, the one table its WGSL and its layout (`copy.ts`) read: the lit image, the
 *  backdrop it writes, and the verdict holding the rectangle. */
export const WATER_COPY_BINDINGS = { lit: 0, backdrop: 1, verdict: 2 } as const
const B = WATER_COPY_BINDINGS

/** The lit image's texels within the backdrop copy the GPU wrote (`argsWgsl.ts`), each stored as
 *  it was loaded: a half-float widened to single precision and narrowed back, the same bits. */
export const WATER_COPY_SHADER = wgslProgram(
  `@group(0) @binding(${B.lit}) var lit:texture_2d<f32>;
@group(0) @binding(${B.backdrop}) var backdrop:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(${B.verdict}) var<storage,read> verdict:array<u32>;
@compute @workgroup_size(${WATER_COPY_TILE},${WATER_COPY_TILE})
fn copyBackdrop(@builtin(global_invocation_id) id:vec3u){
 let size=vec2u(verdict[VERDICT_COPY+2u],verdict[VERDICT_COPY+3u]);
 if(any(id.xy>=size)){return;}
 let at=vec2u(verdict[VERDICT_COPY],verdict[VERDICT_COPY+1u])+id.xy;
 textureStore(backdrop,at,textureLoad(lit,at,0));
}`,
  [VERDICT_WGSL],
)
