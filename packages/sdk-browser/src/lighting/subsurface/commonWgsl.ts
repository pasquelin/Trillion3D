import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TAU } from '../../../../math/src/constants.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { rand3dPcg16 } from '../../../../math/src/wgsl/sampling.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { SUBSURFACE_OPACITY_THRESHOLD } from '../../../../sdk-core/src/lighting/subsurfaceProfile/profile.ts'
import { unitNormalOrUp } from '../../../../math/src/wgsl/geometry.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { DEPTH_WGSL } from '../../post/taa/depthWgsl.ts'
import { VECTOR_CODEC_WGSL } from '../../post/taa/velocityWgsl.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { pixelModelOf, scattersPixelModel } from '../../materials/surface/pixelModel.ts'
import { PROFILE_COLUMNS } from '../../../../sdk-core/src/lighting/subsurfaceProfile/table.ts'
import { CM_TO_MM } from '../../../../sdk-core/src/lighting/subsurfaceProfile/burleyMath.ts'
import { SUBSURFACE_KERNEL_SIZE } from '../../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts'
import { SSS_BINDINGS, SSS_PARAMS } from './layout.ts'

/**
 * WHAT EVERY KERNEL OF THE SUBSURFACE PASS READS (group 0): the uniform (`SSS_PARAMS`), the depth pyramid, the surfaces and the
 * profile table.
 * - A pixel is a profile pixel when its surface flags carry the subsurface profile model or the eye's (`sssIsProfile`, `scattersPixelModel`); its profile (`sssProfileAt`)
 *   is the `x` of the data the shade pass left for it and its opacity, the share of the profile's radius it scatters over
 *   (`sssOpacityAt`), the `w`. A pixel of none reads the profile 0, the default skin's row.
 * - The depth of a pixel in centimetres (`sssDepthAt`), from the opaque depth the image drew.
 * - The profile table: a row a profile, a texel a column (`PROFILE_COLUMNS`); the kernel's offsets are stored over the kernel range
 *   (`sssKernel`).
 * - The sampled scattering's constants: the scaling of the diffuse mean free path by the surface albedo (`sssScaleOf`) and the
 *   distribution it draws radii from (`sssCdf`, `sssPdf`, `sssRadiusOf`).
 */
export const SSS_COMMON_WGSL = wgslBlock(
  'SSS_COMMON_WGSL',
  [
    hizDepthWgsl(0, SSS_BINDINGS.depth),
    DEPTH_WGSL,
    pixelModelOf,
    luminance,
    VECTOR_CODEC_WGSL,
    PI,
    rand3dPcg16,
    unitNormalOrUp,
  ],
  `${SSS_PARAMS.wgsl}
@group(0) @binding(${SSS_BINDINGS.params}) var<uniform> view:SssParams;
@group(0) @binding(${SSS_BINDINGS.normals}) var normalsTex:texture_2d<f32>;
@group(0) @binding(${SSS_BINDINGS.base}) var baseTex:texture_2d<f32>;
@group(0) @binding(${SSS_BINDINGS.flags}) var flagsTex:texture_2d<u32>;
@group(0) @binding(${SSS_BINDINGS.data}) var dataTex:texture_2d<f32>;
@group(0) @binding(${SSS_BINDINGS.profiles}) var profileTex:texture_2d<f32>;
@group(0) @binding(${SSS_BINDINGS.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${SSS_BINDINGS.sampler}) var linearSampler:sampler;
const SSS_INVALID:u32=255u;
const SSS_KERNEL_SIZE:f32=${SUBSURFACE_KERNEL_SIZE}.0;
const SSS_OPACITY_EPS:f32=${wgslF32(SUBSURFACE_OPACITY_THRESHOLD)};
const CM_TO_MM:f32=${CM_TO_MM}.0;
fn sssBilinearMin()->vec2f{return vec2f(0.5)/view.sub.zw;}
fn sssBilinearMax()->vec2f{return (view.sub.xy-vec2f(0.5))/view.sub.zw;}
fn sssPixelAtUv(uv:vec2f)->vec2i{return vec2i(floor(uv*view.scene.zw));}
fn sssIsProfile(p:vec2i)->bool{let model=pixelModelOf(textureLoad(flagsTex,p,0).r);return ${scattersPixelModel('model')};}
fn sssProfileAt(p:vec2i)->u32{
 if(!sssIsProfile(p)){return 0u;}
 return u32(max(round(textureLoad(dataTex,p,0).x),0.0));
}
fn sssOpacityAt(p:vec2i)->f32{return select(0.0,textureLoad(dataTex,p,0).w,sssIsProfile(p));}
// Kept: it reads the program's own normals texture, which a shared function cannot take as an argument.
fn sssNormalAt(p:vec2i)->vec3f{return unitNormalOrUp(textureLoad(normalsTex,p,0).xyz);}
fn sssDepthAt(p:vec2i)->f32{return sceneDepthOf(hizOpaqueDepth(p))*${CENTIMETRES_PER_METRE}.0;}
fn sssRow(x:u32,id:u32)->vec4f{return textureLoad(profileTex,vec2i(i32(x),i32(id)),0);}
fn sssKernel(x:u32,id:u32)->vec4f{return sssRow(x,id)*vec4f(1.0,1.0,1.0,SSS_KERNEL_SIZE);}
fn sssTint(id:u32)->vec3f{return sssRow(${PROFILE_COLUMNS.tint}u,id).rgb;}
fn sssBleed(id:u32)->vec3f{return sssRow(${PROFILE_COLUMNS.boundary}u,id).rgb;}
fn sssUseBurley(id:u32)->bool{return abs(sssRow(${PROFILE_COLUMNS.boundary}u,id).a)<0.01;}
struct SssBurley{albedo:vec4f,dmfp:vec4f,unit:f32,opacity:f32}
fn sssBurley(id:u32,opacity:f32)->SssBurley{
 var o:SssBurley;
 o.albedo=sssRow(${PROFILE_COLUMNS.albedo}u,id);
 o.unit=sssRow(${PROFILE_COLUMNS.tint}u,id).a*50.0*CM_TO_MM;
 o.opacity=opacity;
 o.dmfp=sssRow(${PROFILE_COLUMNS.dmfp}u,id)*500.0*opacity;
 return o;
}
fn sssScaleOf(a:f32)->f32{let v=a-0.33;return 3.5+100.0*v*v*v*v;}
fn sssScale3(a:vec3f)->vec3f{let v=a-vec3f(0.33);return vec3f(3.5)+100.0*v*v*v*v;}
fn sssCdf(d:f32,x:f32)->f32{return 1.0-0.25*exp(-x/d)-0.75*exp(-x/(3.0*d));}
fn sssPdf(radius:f32,l:f32,s:f32)->f32{
 let d=l/s;
 return max(0.25/d*(exp(-radius/d)+exp(-radius/(3.0*d))),0.00001);
}
fn sssRadiusOf(d:f32,r:f32)->f32{return d*((2.0-2.6)*r-2.0)*log(1.0-r);}
fn sssProfileDensity(l:vec3f,s:vec3f,radius:f32)->vec3f{
 let d=vec3f(1.0)/s;
 let neg=-(radius/l)/d;
 return max((exp(neg)+exp(neg/3.0))/(d*l)*${1 / (4 * TAU)},vec3f(0.000000000001));
}
fn sssBurleyScale(unit:f32,depth:f32)->vec2f{
 var s=vec2f(unit);
 s*=view.scatter.x/depth;
 s*=SSS_KERNEL_SIZE/CM_TO_MM;
 s*=view.sub.x/view.sub.z;
 s.y*=view.sub.z/view.sub.w;
 return s;
}
fn sssCenterRadius(scale:vec2f)->f32{return 0.5*(1.0/view.sub.z/scale.x+1.0/view.sub.w/scale.y);}
fn sssCenterCdf(b:SssBurley,radius:f32)->f32{return sssCdf(b.dmfp.a/sssScaleOf(b.albedo.a),radius);}
fn sssCenterWeight(depth:f32,b:SssBurley)->vec3f{
 let radius=sssCenterRadius(sssBurleyScale(b.unit,depth));
 let d=vec3f(b.dmfp.a)/sssScale3(b.albedo.rgb);
 return vec3f(sssCdf(d.x,radius),sssCdf(d.y,radius),sssCdf(d.z,radius));
}
fn sssTileOf(word:u32)->vec2u{return vec2u(word&0xfffu,(word>>12u)&0xfffu);}
fn sssTileWord(t:vec2u)->u32{return (t.x&0xfffu)|((t.y&0xfffu)<<12u);}`,
)
