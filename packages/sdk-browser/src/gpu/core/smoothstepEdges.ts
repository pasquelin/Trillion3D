import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/**
 * `hermite(a, b, x)`: the smooth step from 0 at `a` to 1 at `b`, as the reference's shading language
 * computes it — `saturate((x − a) / (b − a))`, then `t² (3 − 2t)` — for any order of the edges: a
 * reversed ramp where `b` is under `a`, and, where they are equal, a step at that edge (what the
 * division's infinity saturates to; a value of the edge itself is 0, as a NaN saturates there). WGSL's
 * own `smoothstep` is undefined where its edges meet or cross, and the grade's and the grain's
 * bounds are settings a host may write in any order.
 */
export const HERMITE_WGSL = wgslFn(
  'hermite',
  [],
  `fn hermite(a:f32,b:f32,x:f32)->f32{
 if(a==b){return select(0.0,1.0,x>a);}
 let t=saturate((x-a)/(b-a));
 return t*t*(3.0-2.0*t);
}`,
)
