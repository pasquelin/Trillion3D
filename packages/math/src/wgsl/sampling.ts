import { wgslFn } from './decl.ts'

/**
 * Where a shader samples: a seed folded into [0, 1), the interleaved gradient of a pixel, a texel
 * held on its image, the bilinear combine of four taps already read, and the greatest and least
 * channels of a colour.
 * The combine holds no load: each shader reads its four taps its own way, and only the `mix` of
 * `mix` is common, one declaration per type.
 */

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
