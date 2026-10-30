/**
 * A CUBEMAP'S BRIGHTEST CHANNEL, REDUCED ON THE GPU (`cubePeak.ts`): the cube held as full floats is reduced mip by mip, each texel of a
 * mip the largest of the texels it covers in the mip above (`downsampleCubeMax`), then the six faces of the last, one-texel mip are
 * reduced to the largest of their red, green and blue (`maxCubeLuminance`), one float the host reads back. For a side that halves
 * evenly a texel covers its four; for an odd one it covers the rows and columns its span reaches, so no texel is left out.
 */

/** The downsampling's entry: a mip of the cube from the one above, per texel the largest of the texels it covers. */
export const CUBE_DOWNSAMPLE_MAX_ENTRY = 'downsampleCubeMax'

/** Where the downsampling's bindings lie in group 0. */
export const CUBE_DOWNSAMPLE_MAX_BINDINGS = { source: 0, reduced: 1 } as const

/** The reduction of one mip of the cube from the one above, one dispatch a mip, the six faces along z. */
export const cubeDownsampleMaxShader = () =>
  `@group(0) @binding(${CUBE_DOWNSAMPLE_MAX_BINDINGS.source}) var maxSource:texture_2d_array<f32>;
@group(0) @binding(${CUBE_DOWNSAMPLE_MAX_BINDINGS.reduced}) var maxReduced:texture_storage_2d_array<rgba32float,write>;
@compute @workgroup_size(8,8,1)
fn ${CUBE_DOWNSAMPLE_MAX_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let side=textureDimensions(maxReduced).x;
 if(id.x>=side||id.y>=side){return;}
 let parent=textureDimensions(maxSource).x;
 let lo=vec2u((id.xy*parent)/vec2u(side));
 let hi=max(lo+vec2u(1u),vec2u(((id.xy+vec2u(1u))*parent+vec2u(side-1u))/vec2u(side)));
 var peak=vec4f(0.0);
 for(var y=lo.y;y<hi.y;y++){
  for(var x=lo.x;x<hi.x;x++){
   peak=max(peak,textureLoad(maxSource,vec2u(x,y),id.z,0));
  }
 }
 textureStore(maxReduced,id.xy,id.z,peak);
}`

/** The final reduction's entry: the largest channel of the six one-texel faces, written to the first float of the output. */
export const CUBE_MAX_LUMINANCE_ENTRY = 'maxCubeLuminance'

/** Where the final reduction's bindings lie in group 0. */
export const CUBE_MAX_LUMINANCE_BINDINGS = { last: 0, peak: 1 } as const

/** The largest of the red, green and blue of the cube's six faces at its last mip, one float. */
export const cubeMaxLuminanceShader = () =>
  `@group(0) @binding(${CUBE_MAX_LUMINANCE_BINDINGS.last}) var lastMip:texture_2d_array<f32>;
@group(0) @binding(${CUBE_MAX_LUMINANCE_BINDINGS.peak}) var<storage,read_write> cubePeakOut:array<f32>;
@compute @workgroup_size(1)
fn ${CUBE_MAX_LUMINANCE_ENTRY}(){
 var rgb=vec3f(0.0);
 for(var face=0u;face<6u;face++){
  rgb=max(rgb,textureLoad(lastMip,vec2u(0u),face,0).rgb);
 }
 cubePeakOut[0]=max(rgb.r,max(rgb.g,rgb.b));
}`
