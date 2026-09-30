import { AS_IS_FLAG } from '../../scene/surfaceModel.ts';
import { FULLSCREEN_VERTEX } from './shaders.ts';

/** The seed of the as-is share (`asIsShare.ts`): 1 where the opaque flags say as-is, 0 elsewhere. */
export const AS_IS_SHARE_SHADER = `${FULLSCREEN_VERTEX}
@group(0) @binding(0) var flags:texture_2d<u32>;
@fragment fn seed(@builtin(position) pixel:vec4f)->@location(0) vec2f{
 return vec2f(f32(textureLoad(flags,vec2i(pixel.xy),0).r==${AS_IS_FLAG}u),0.0);
}`;
