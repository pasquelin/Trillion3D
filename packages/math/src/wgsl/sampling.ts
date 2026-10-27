import { wgslFn } from './decl.ts'
import { PI, PLASTIC_STEP, QUARTER_PI, TWO_PI } from './constants.ts'
import { sinFromCosUnclamped } from './geometry.ts'

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
/** Four 32-bit words of a 4D integer point: the 4D PCG hash (Jarzynski & Olano 2020), one LCG step,
 *  two rounds of four multiply-adds around a fold of each word's high half into its low. */
export const rand4dPcg32 = wgslFn(
  'rand4dPcg32',
  [],
  `fn rand4dPcg32(p:vec4i)->vec4u{
 var v=bitcast<vec4u>(p)*1664525u+1013904223u;
 v.x+=v.y*v.w;v.y+=v.z*v.x;v.z+=v.x*v.y;v.w+=v.y*v.z;
 v^=v>>vec4u(16u);
 v.x+=v.y*v.w;v.y+=v.z*v.x;v.z+=v.x*v.y;v.w+=v.y*v.z;
 return v;
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
/**
 * The approximate equal-area map of the unit square onto the unit disc, the one a soft shadow's or a
 * blur's taps use where the exact map's trigonometry is not worth its cost: the square is centred
 * and scaled to half a diagonal either side; the coordinate of the larger square (y when they tie)
 * is replaced by the root of twice the larger square less the smaller, its sign kept. The points
 * are not exactly uniform on the disc, and all of the square lands inside it.
 */
export const approxDiskMap = wgslFn(
  'approxDiskMap',
  [],
  `fn approxDiskMap(e:vec2f)->vec2f{
 var sf=e*sqrt(2.0)-sqrt(0.5);
 let sq=sf*sf;
 let root=sqrt(2.0*max(sq.x,sq.y)-min(sq.x,sq.y));
 if(sq.x>sq.y){sf.x=select(-root,root,sf.x>0.0);}else{sf.y=select(-root,root,sf.y>0.0);}
 return sf;
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

/** A direction of the unit sphere, evenly over its area: `e.x` turns it about the third axis, `e.y`
 *  runs its cosine from 1 down to -1. */
export const sampleSphereEven = wgslFn(
  'sampleSphereEven',
  [PI, sinFromCosUnclamped],
  `fn sampleSphereEven(e:vec2f)->vec3f{
 let phi=2.0*PI*e.x;
 let cosTheta=1.0-2.0*e.y;
 let sinTheta=sinFromCosUnclamped(cosTheta);
 return vec3f(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}`,
)

/**
 * The half vector of a GGX lobe of widths `alpha` seen from `v`, both in the surface's frame (z the
 * normal), drawn among the normals the eye sees by `e` (Dupuy and Benyoub, "Sampling Visible GGX Normals
 * with Spherical Caps", 2023): the view stretched by the widths, a point on the spherical cap it covers —
 * the cap's height bounded by the reflection of the view (Eto and Tokuyoshi, "Bounded VNDF Sampling for
 * Smith-GGX Reflections", 2023), so that no half vector sends the reflected ray below the horizon —,
 * unstretched. `e.y` scales the cap's height: a caller that pulls it toward the middle draws fewer grazing
 * normals. The normal itself where the unstretched vector has no length.
 */
export const visibleGgxHalf = wgslFn(
  'visibleGgxHalf',
  [TWO_PI],
  `fn visibleGgxHalf(e:vec2f,alpha:vec2f,v:vec3f)->vec3f{
 let seen=normalize(vec3f(alpha*v.xy,v.z));
 let a=saturate(min(alpha.x,alpha.y));
 let wide=1.0+length(v.xy);
 let k=(wide*wide-a*a*wide*wide)/(wide*wide+a*a*v.z*v.z);
 let z=mix(1.0,-k*seen.z,e.y);
 let sine=sqrt(saturate(1.0-z*z));
 let phi=TWO_PI*e.x;
 let h=vec3f(sine*cos(phi),sine*sin(phi),z)+seen;
 let stretched=vec3f(alpha*h.xy,max(0.0,h.z));
 return select(vec3f(0.0,0.0,1.0),normalize(stretched),dot(stretched,stretched)>0.0);
}`,
)
