import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'

/** The offset, in tiles, between the sample that bends x and the one that bends y in a warp, so
 *  that the two axes read the noise at different points and the warp is not a pure diagonal. Any pair
 *  of unrelated numbers serves. */
const WARP_OFFSET = [0.37, 0.71] as const

/**
 * THE PERIODIC GRADIENT NOISE OF THE PLANE the global mask is made from, one
 * block: `gradientNoise`, the noise of the grid of `cells` cells a side at `q`, in about [-0.7, 0.7]:
 * the four corners' unit gradients, hashed from the corner's cell wrapped by the period so that the
 * noise tiles, dotted with the offsets to them and blended by the quintic fade; `fractal`, `octaves`
 * of it, each with twice the cells and `gain` times the weight, the weights summing to one; and `warpedFractal`, that fractal read after two warps by itself, each of `warp` tiles.
 */
export const GRADIENT_NOISE = wgslBlock(
  'GRADIENT_NOISE',
  [rand3dPcg16, TWO_PI],
  `fn gradientAt(cell:vec2i,period:i32,salt:i32)->vec2f{
 let wrapped=((cell%vec2i(period))+vec2i(period))%vec2i(period);
 let angle=f32(rand3dPcg16(vec3i(wrapped,salt)).x)*(TWO_PI/65536.0);
 return vec2f(cos(angle),sin(angle));
}
fn gradientNoise(q:vec2f,cells:i32,salt:i32)->f32{
 let x=q*f32(cells);
 let low=floor(x);
 let f=x-low;
 let fade=f*f*f*(f*(f*6.0-15.0)+10.0);
 var sum=0.0;
 for(var k=0;k<4;k++){
  let corner=vec2i(k&1,(k>>1)&1);
  let w=select(vec2f(1.0)-fade,fade,corner==vec2i(1));
  sum+=w.x*w.y*dot(gradientAt(vec2i(low)+corner,cells,salt),f-vec2f(corner));
 }
 return sum;
}
fn fractal(q:vec2f,cells:i32,octaves:i32,gain:f32,salt:i32)->f32{
 var sum=0.0;
 var weight=1.0;
 var total=0.0;
 var n=cells;
 for(var i=0;i<octaves;i++){
  sum+=weight*gradientNoise(q,n,salt+i);
  total+=weight;
  weight*=gain;
  n*=2;
 }
 return sum/total;
}
fn warpedFractal(q0:vec2f,cells:i32,octaves:i32,gain:f32,salt:i32,warp:f32)->f32{
 var q=q0;
 for(var bend=0;bend<2;bend++){
  q+=warp*vec2f(
   fractal(q,cells,octaves,gain,salt),
   fractal(q+vec2f(${WARP_OFFSET.map(wgslF32).join(',')}),cells,octaves,gain,salt));
 }
 return fractal(q,cells,octaves,gain,salt);
}
`,
)
