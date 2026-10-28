import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { SCREEN_SPACE_GROUP_SIDE } from './screenSpaceQuality.ts'

/** The bindings of the half-resolution pass: the image to halve and the half-size result. */
export const HALF_RES_BINDINGS = { source: 0, result: 1 } as const

/**
 * THE LAST LIT IMAGE AT HALF RESOLUTION (halfResCompute), a thread a texel of the result: the mean of the 2 by 2 block of the image
 * it stands for, the edge texel of an odd size repeated. What the screen reflections' rays read, with a bilinear sampler, when
 * `screenReflectionHalfResColor` is on.
 */
export const halfResWgsl = () =>
  wgslProgram(
    `@group(0) @binding(${HALF_RES_BINDINGS.source}) var fullImage:texture_2d<f32>;
@group(0) @binding(${HALF_RES_BINDINGS.result}) var halfImage:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn halfResCompute(@builtin(global_invocation_id) id:vec3u){
 let size=vec2u(textureDimensions(halfImage));
 if(any(id.xy>=size)){return;}
 let last=vec2i(textureDimensions(fullImage))-vec2i(1);
 let base=vec2i(id.xy)*2;
 let mean=(textureLoad(fullImage,min(base,last),0)
  +textureLoad(fullImage,min(base+vec2i(1,0),last),0)
  +textureLoad(fullImage,min(base+vec2i(0,1),last),0)
  +textureLoad(fullImage,min(base+vec2i(1,1),last),0))*0.25;
 textureStore(halfImage,vec2i(id.xy),mean);
}`,
    [],
  )
