import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { edgeFunction } from '../../../../math/src/wgsl/barycentric.ts'

/**
 * A pixel's perspective-correct weights on its triangle's corners and their change across one pixel,
 * in one function, as the reference computes them (`CalculateTriangleBarycentrics`): the affine
 * weights `a` and their constant steps `ax`, `ay`, then, with the corners' clip `1/w` `iw`,
 * `g = a * iw`, `h = sum(g)`, the weights `g / h` and their steps `(g' * h - g * h') / h^2`.
 * `value` is the weights `perspectiveBarycentric` returns (same operations, same bits), `dx` and
 * `dy` their change one pixel right and one down. The triangle's side on the screen is the sign of
 * `dx.y * dy.x - dx.x * dy.y` (negative for a positive `area` and positive `w`, the reference's
 * two-sided test); the texture coordinates' derivatives and the neighbours' weights read the steps.
 * Both steps are zero where `h` is, and for a degenerate triangle (`area` zero), whose weights are a
 * fixed third each.
 */
export const PIXEL_BARYCENTRIC_WGSL = wgslBlock(
  'PIXEL_BARYCENTRIC_WGSL',
  [edgeFunction],
  `struct PixelBary{value:vec3f,dx:vec3f,dy:vec3f,}
fn pixelBarycentric(s0:vec3f,s1:vec3f,s2:vec3f,iw:vec3f,p:vec2f,area:f32)->PixelBary{
 if(area==0.0){return PixelBary(vec3f(0.333,0.333,0.334),vec3f(0.0),vec3f(0.0));}
 let a0=edgeFunction(s1.xy,s2.xy,p)/area;let a1=edgeFunction(s2.xy,s0.xy,p)/area;
 let a=vec3f(a0,a1,1.0-a0-a1);
 let ax0=-(s2.y-s1.y)/area;let ax1=-(s0.y-s2.y)/area;let ay0=(s2.x-s1.x)/area;let ay1=(s0.x-s2.x)/area;
 let ax=vec3f(ax0,ax1,-ax0-ax1);let ay=vec3f(ay0,ay1,-ay0-ay1);
 let g=a*iw;let h=g.x+g.y+g.z;
 if(h==0.0){return PixelBary(a,vec3f(0.0),vec3f(0.0));}
 let gx=ax*iw;let gy=ay*iw;let hx=gx.x+gx.y+gx.z;let hy=gy.x+gy.y+gy.z;
 let rh=1.0/(h*h);
 return PixelBary(g/h,(gx*h-g*hx)*rh,(gy*h-g*hy)*rh);
}`,
)
