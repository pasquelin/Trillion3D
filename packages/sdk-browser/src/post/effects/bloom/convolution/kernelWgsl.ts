import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'

/**
 * The uniform of the kernel's three passes:
 * - `limit`: the brightest haze beside the kernel's centre, per channel, which the kernel is held to;
 * - `dst`: the transform's size in texels along x and y;
 * - `image`: the image's size in texels and the texel of the kernel's centre;
 * - `scale`: the inverse of the kernel's size in texels along x and y, and the kernel's width as a
 *   share of the image's.
 */
export const KERNEL_PARAMS = fieldLayout('Kernel', [
  ['limit', 'vec4f'],
  ['dst', 'vec4u'],
  ['image', 'vec4u'],
  ['scale', 'vec4f'],
] as const)
/** Bytes of the kernel passes' uniform. */
export const KERNEL_BYTES = KERNEL_PARAMS.words * 4

/** The format the kernel's resized picture is drawn in, for the transform to read: four floats, as the
 *  transform's own values are. */
export const RESIZED_FORMAT: GPUTextureFormat = 'rgba32float'
/** The format the prepared kernel is held in: half floats, a picture the transform does not read. */
export const KERNEL_FORMAT: GPUTextureFormat = 'rgba16float'

/** The bindings of the kernel's passes, by the names the shader gives them: the uniform, the picture
 *  read, the sampler it is read through, the prepared kernel and the resized picture written. */
export const KERNEL_BINDINGS = { params: 0, source: 1, reader: 2, held: 3, drawn: 4 } as const

/** Texels along a side of the groups of the kernel's passes. */
export const KERNEL_TILE = 8

/**
 * THE KERNEL, PREPARED FOR THE TRANSFORM, three passes of one thread to a texel:
 * - `holdKernel` holds each texel to [0, `limit`] per channel — the centre's peak is cut to the haze
 *   around it, which is all the glow spreads — and gives the alpha the blue: the image's own alpha is
 *   carried beside its colour, which the kernel's does not spread;
 * - `halveKernel` brings the kernel down to half its side, each texel the mean of four bilinear reads
 *   a little out along the diagonals — 0.7 texel of the level above, a reading of its own, not the
 *   downsample filters' (`halveWide`), which it must not be unified with —, so a kernel much larger
 *   than the image is not read by stepping over its texels;
 * - `resizeKernel` draws the kernel at the size it has over the image — its width times the image's
 *   longest side — in the transform's square, its centre at the corner (0, 0) and the rest wrapped
 *   around the square's edges, as the transform's own periodicity reads it. A kernel too large for the
 *   square is folded into it from the four corners.
 */
export const KERNEL_WGSL = wgslProgram(
  `
${KERNEL_PARAMS.wgsl}
@group(0) @binding(${KERNEL_BINDINGS.params}) var<uniform> kernel:Kernel;
@group(0) @binding(${KERNEL_BINDINGS.source}) var source:texture_2d<f32>;
@group(0) @binding(${KERNEL_BINDINGS.reader}) var reader:sampler;
@group(0) @binding(${KERNEL_BINDINGS.held}) var held:texture_storage_2d<${KERNEL_FORMAT},write>;
@group(0) @binding(${KERNEL_BINDINGS.drawn}) var drawn:texture_storage_2d<${RESIZED_FORMAT},write>;
@compute @workgroup_size(${KERNEL_TILE},${KERNEL_TILE})
fn holdKernel(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(source);
 if(id.x>=size.x||id.y>=size.y){return;}
 var value=clamp(textureLoad(source,vec2i(id.xy),0),vec4f(0.0),kernel.limit);
 value.a=value.b;
 textureStore(held,vec2i(id.xy),value);
}
@compute @workgroup_size(${KERNEL_TILE},${KERNEL_TILE})
fn halveKernel(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(held);
 if(id.x>=size.x||id.y>=size.y){return;}
 let above=vec2f(textureDimensions(source));
 let uv=(vec2f(id.xy)*2.0+1.0)/above;
 let out=0.7/above;
 var mean=0.25*textureSampleLevel(source,reader,uv+vec2f(1.0,1.0)*out,0.0);
 mean+=0.25*textureSampleLevel(source,reader,uv+vec2f(1.0,-1.0)*out,0.0);
 mean+=0.25*textureSampleLevel(source,reader,uv+vec2f(-1.0,-1.0)*out,0.0);
 mean+=0.25*textureSampleLevel(source,reader,uv+vec2f(-1.0,1.0)*out,0.0);
 textureStore(held,vec2i(id.xy),mean);
}
fn gather(at:vec2f)->vec4f{return textureSampleLevel(source,reader,at,0.0);}
@compute @workgroup_size(${KERNEL_TILE},${KERNEL_TILE})
fn resizeKernel(@builtin(global_invocation_id) id:vec3u){
 let square=kernel.dst.xy;
 if(id.x>=square.x||id.y>=square.y){return;}
 let centre=(vec2f(kernel.image.zw)+0.5)*kernel.scale.xy;
 let reach=max(f32(max(kernel.image.x,kernel.image.y))*kernel.scale.z,1.0);
 let whole=vec2f(square);
 let p=vec2f(id.xy);
 var result=vec4f(0.0);
 if(!(whole.y>centre.y*reach)||!(whole.x>centre.x*reach)){
  let ul=p/reach;
  let ur=vec2f(whole.x-p.x,p.y)/reach;
  let ll=vec2f(p.x,whole.y-p.y)/reach;
  let lr=(whole-p)/reach;
  var folded=vec4f(0.0);
  if(ul.x<0.5&&ul.y<0.5){let v=gather(ul+centre);folded=vec4f(folded.rgb+v.rgb,max(folded.a,v.a));}
  if(ur.x<0.5&&ur.y<0.5){let v=gather(vec2f(centre.x-ur.x,centre.y+ur.y));folded=vec4f(folded.rgb+v.rgb,max(folded.a,v.a));}
  if(ll.x<0.5&&ll.y<0.5){let v=gather(vec2f(centre.x+ll.x,centre.y-ll.y));folded=vec4f(folded.rgb+v.rgb,max(folded.a,v.a));}
  if(lr.x<0.5&&lr.y<0.5){let v=gather(centre-lr);folded=vec4f(folded.rgb+v.rgb,max(folded.a,v.a));}
  result=folded;
 }else{
  let units=whole/reach;
  let at=fract((p/reach+centre)/units)*units;
  if(at.x<1.0&&at.y<1.0){result=gather(at);}
 }
 textureStore(drawn,vec2i(id.xy),result);
}`,
  [],
)
