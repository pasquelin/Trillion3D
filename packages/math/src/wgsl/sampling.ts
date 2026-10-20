import { wgslFn } from './decl.ts'
import { PLASTIC_STEP, QUARTER_PI } from './constants.ts'

/**
 * Where a shader samples: a seed folded into [0, 1), the interleaved gradient of a pixel, a texel
 * held on its image, the bilinear combine of four taps already read, and the greatest and least
 * channels of a colour.
 * The combine holds no load: each shader reads its four taps its own way, and only the `mix` of
 * `mix` is common, one declaration per type.
 */

/**
 * One word of integer hash: an odd golden multiply, an xor-shift, a second multiply, a last
 * xor-shift (`mixWord` in `../scalar/integers.ts` on the processor, tested word for word). Every
 * hash that keys a table or settles a value reads it; a second word of one input is
 * `mixWord(x ^ GOLDEN_U32)`. The denoiser's filter taps hash a 3D point their own way
 * (`rand3dPcg16`).
 */
export const mixWord = wgslFn(
  'mixWord',
  [],
  `fn mixWord(x:u32)->u32{
 var h=x*0x9e3779b1u;
 h^=h>>15u;h*=0x85ebca77u;h^=h>>13u;
 return h;
}`,
)

/** Point `n` of the additive two-dimensional sequence (`PLASTIC_STEP`), its points spread evenly
 *  over the unit square, turned by `shift` (a rotation of the square; zero for none). */
export const additive2d = wgslFn(
  'additive2d',
  [PLASTIC_STEP],
  'fn additive2d(shift:vec2f,n:u32)->vec2f{return fract(shift+f32(n)*PLASTIC_STEP);}',
)

/** The interleaved gradient noise of pixel `p` at image `frame` (Jimenez 2014), in [0, 1): the
 *  position moved by `frame · (47, 17) · 0.695` each image. */
export const interleavedGradientNoise = wgslFn(
  'interleavedGradientNoise',
  [],
  `fn interleavedGradientNoise(p:vec2f,frame:f32)->f32{
 let uv=p+frame*vec2f(47.0,17.0)*0.695;
 return fract(52.9829189*fract(dot(uv,vec2f(0.06711056,0.00583715))));
}`,
)

export const hashUnit = wgslFn(
  'hashUnit',
  [],
  `fn hashUnit(seed:u32)->f32{
 var x=seed*747796405u+2891336453u;
 x=((x>>((x>>28u)+4u))^x)*277803737u;
 x=(x>>22u)^x;
 return f32(x)*2.3283064e-10;
}`,
)

/**
 * Stratified points of a disc, the reflection denoiser's spatial filter taps: `rand3dPcg16`, three
 * 16-bit words of a 3D integer point (a PCG-style 3D hash, Jarzynski & Olano 2020: one LCG step, six
 * multiply-add Feistel rounds, the top halves); `hammersley16`, the `index`-th of `count` Hammersley
 * points scrambled by two such words (Cranley-Patterson rotation of the first coordinate, an XOR
 * scramble of the radical inverse); `uniformDiskConcentric`, Shirley & Chiu's 1997 concentric map
 * of the unit square onto the unit disc, which keeps strata compact.
 */
export const rand3dPcg16 = wgslFn(
  'rand3dPcg16',
  [],
  `fn rand3dPcg16(p:vec3i)->vec3u{
 var v=bitcast<vec3u>(p)*1664525u+1013904223u;
 v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;
 v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;
 return v>>vec3u(16u);
}`,
)
export const hammersley16 = wgslFn(
  'hammersley16',
  [],
  `fn hammersley16(index:u32,count:u32,random:vec2u)->vec2f{
 let e1=fract(f32(index)/f32(count)+f32(random.x)*(1.0/65536.0));
 return vec2f(e1,f32((reverseBits(index)>>16u)^random.y)*(1.0/65536.0));
}`,
)
export const uniformDiskConcentric = wgslFn(
  'uniformDiskConcentric',
  [QUARTER_PI],
  `fn uniformDiskConcentric(e:vec2f)->vec2f{
 let p=2.0*e-0.99999994;
 let a=abs(p);
 let hi=max(a.x,a.y);
 let phi=QUARTER_PI*(min(a.x,a.y)/(hi+5.42101086e-20)+2.0*f32(a.y>=a.x));
 let unsigned=bitcast<vec2u>(vec2f(cos(phi),sin(phi)))&vec2u(0x7fffffffu);
 return bitcast<vec2f>(unsigned|(bitcast<vec2u>(p)&vec2u(0x80000000u)))*hi;
}`,
)

export const bilinear4 = wgslFn(
  'bilinear4',
  [],
  'fn bilinear4(a:vec4f,b:vec4f,c:vec4f,d:vec4f,f:vec2f)->vec4f{return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}',
)

export const bilinear3 = wgslFn(
  'bilinear3',
  [],
  'fn bilinear3(a:vec3f,b:vec3f,c:vec3f,d:vec3f,f:vec2f)->vec3f{return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}',
)

export const maxChannel = wgslFn(
  'maxChannel',
  [],
  'fn maxChannel(c:vec3f)->f32{return max(c.r,max(c.g,c.b));}',
)

export const minChannel = wgslFn(
  'minChannel',
  [],
  'fn minChannel(c:vec3f)->f32{return min(c.r,min(c.g,c.b));}',
)

/** The texel `p` held on an image of `size` texels, `clamp(p, 0, size − 1)` per axis: the fetch at
 *  an edge reads the edge's texel. */
export const clampToExtent = wgslFn(
  'clampToExtent',
  [],
  'fn clampToExtent(p:vec2i,size:vec2i)->vec2i{return clamp(p,vec2i(0),size-vec2i(1));}',
)

/**
 * The slope of a surface along one axis of a depth image, in depth per texel, from the depth `z`
 * a texel holds and the two before it and after it (`before`, `after`, then `farBefore`,
 * `farAfter`): read on a side whose two texels continue the surface — the step into the texel
 * differs from the step beyond it by less than that step: a plane makes them equal, where a
 * silhouette makes the first a jump that the background beyond does not continue —; of two such
 * sides, the straighter; none when neither side continues (a wire, a bar, a far part one texel
 * wide). The one rule of every reader of a depth's slope: the plane the depth pyramid keeps at each
 * pixel, the temporal history's depth slack, the guides' jitter slack.
 */
export const surfaceSlopeOf = wgslFn(
  'surfaceSlopeOf',
  [],
  `fn surfaceSlopeOf(z:f32,before:f32,after:f32,farBefore:f32,farAfter:f32)->f32{
 let into=vec2f(z-before,after-z);
 let beyond=vec2f(before-farBefore,farAfter-after);
 let bend=abs(into-beyond);let continues=bend<abs(beyond);
 if(continues.x&&(!continues.y||bend.x<=bend.y)){return into.x;}
 return select(0.0,into.y,continues.y);
}`,
)
