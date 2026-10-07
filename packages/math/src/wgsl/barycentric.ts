import { wgslFn } from './decl.ts'

/**
 * A point's weights on a triangle's corners, three forms the shaders use: affine on the screen
 * from the edge function, perspective-correct from the corners' `1/w`, and on the triangle's own
 * plane in space. Each weighs another way and rounds its own way; none stands for another.
 */

/** Twice the signed area of the screen triangle `(a, b, p)`: positive when `p` lies to the left
 *  of `a → b` in a frame whose `y` grows up. */
export const edgeFunction = wgslFn(
  'edgeFunction',
  [],
  'fn edgeFunction(a:vec2f,b:vec2f,p:vec2f)->f32{return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}',
)

/** The affine weights of `p` on `a, b, c`, `area` their `edgeFunction(a, b, c)`; the third is one
 *  minus the others. */
export const affineBarycentric = wgslFn(
  'affineBarycentric',
  [edgeFunction],
  `fn affineBarycentric(a:vec2f,b:vec2f,c:vec2f,p:vec2f,area:f32)->vec3f{
 let w0=edgeFunction(b,c,p)/area;let w1=edgeFunction(c,a,p)/area;
 return vec3f(w0,w1,1.0-w0-w1);
}`,
)

/** The perspective-correct weights of `p` on the screen corners `s0..s2` (`xy` read), `iw` their
 *  `1/w`, `area` their signed area: the affine weights scaled by `1/w` and renormalised, kept
 *  affine where the scaled sum is zero; a fixed third each on a degenerate triangle. */
export const perspectiveBarycentric = wgslFn(
  'perspectiveBarycentric',
  [affineBarycentric],
  `fn perspectiveBarycentric(s0:vec3f,s1:vec3f,s2:vec3f,iw:vec3f,p:vec2f,area:f32)->vec3f{
 if(area==0.0){return vec3f(0.333,0.333,0.334);}
 let bw=affineBarycentric(s0.xy,s1.xy,s2.xy,p,area);let a0=bw.x;let a1=bw.y;let a2=bw.z;
 let p0w=a0*iw.x;let p1w=a1*iw.y;let p2w=a2*iw.z;let sum=p0w+p1w+p2w;
 return select(vec3f(a0,a1,a2),vec3f(p0w,p1w,p2w)/sum,sum!=0.0);
}`,
)

/** The weights of `q`, projected on the plane of `a, b, c`, by the normal equations of its two
 *  edges; all on `a` for a degenerate triangle. */
export const planeBarycentric = wgslFn(
  'planeBarycentric',
  [],
  `fn planeBarycentric(q:vec3f,a:vec3f,b:vec3f,c:vec3f)->vec3f{
 let e0=b-a;let e1=c-a;let e2=q-a;
 let d00=dot(e0,e0);let d01=dot(e0,e1);let d11=dot(e1,e1);let d20=dot(e2,e0);let d21=dot(e2,e1);
 let den=d00*d11-d01*d01;
 if(den==0.0){return vec3f(1.0,0.0,0.0);}
 let v=(d11*d20-d01*d21)/den;let w=(d00*d21-d01*d20)/den;
 return vec3f(1.0-v-w,v,w);
}`,
)
