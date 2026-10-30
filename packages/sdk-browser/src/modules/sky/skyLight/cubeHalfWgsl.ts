import { HALF_MAX } from '../../../../../math/src/constants.ts'

/**
 * A CUBEMAP HELD AS FULL FLOATS, CONVERTED TO HALF FLOATS ON THE GPU (`cubeHalf.ts`): the float cube the peak was found over is the
 * source, each texel times the fit's scale (`SkyLightCubemapFit.cube`) and held to what a half float holds, as `rgbToHalfRgba` does on
 * the CPU, so the cube goes up once.
 */

/** The conversion's entry: one texel of the first mip of a face. */
export const CUBE_HALF_ENTRY = 'convertCubeHalf'

/** Where the conversion's bindings lie in group 0. */
export const CUBE_HALF_BINDINGS = { source: 0, half: 1, fit: 2 } as const

/** The conversion of the whole first mip, the six faces along z; the scale is the first float of the uniform. */
export const cubeHalfShader = () =>
  `@group(0) @binding(${CUBE_HALF_BINDINGS.source}) var halfSource:texture_2d_array<f32>;
@group(0) @binding(${CUBE_HALF_BINDINGS.half}) var halfTarget:texture_storage_2d_array<rgba16float,write>;
@group(0) @binding(${CUBE_HALF_BINDINGS.fit}) var<uniform> halfFit:vec4f;
@compute @workgroup_size(8,8,1)
fn ${CUBE_HALF_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let side=textureDimensions(halfTarget).x;
 if(id.x>=side||id.y>=side){return;}
 let rgb=min(textureLoad(halfSource,id.xy,id.z,0).rgb*halfFit.x,vec3f(${HALF_MAX}.0));
 textureStore(halfTarget,id.xy,id.z,vec4f(rgb,1.0));
}`
