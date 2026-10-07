import { wgslFn, wgslStruct } from './decl.ts'

/**
 * A unit vector across a direction: the cross product with an axis the direction is not along.
 * Each shader picks its own axes, threshold and order, and each choice turns a frame differently:
 * six formulas, six declarations, none merged into another. Last, a whole orthonormal frame around
 * a unit axis, branchless, and the moves into and out of it.
 */

export const tangentAround = wgslFn(
  'tangentAround',
  [],
  `fn tangentAround(v:vec3f)->vec3f{
 var axis:vec3f=vec3f(0.0,0.0,1.0);
 if(abs(v.z)>0.999){axis=vec3f(0.0,1.0,0.0);}
 return normalize(cross(axis,v));
}`,
)

export const tangentImpostor = wgslFn(
  'tangentImpostor',
  [],
  `fn tangentImpostor(n:vec3f)->vec3f{
 let up=select(vec3f(0.0,1.0,0.0),vec3f(0.0,0.0,1.0),abs(n.y)>0.999);
 return normalize(cross(up,n));
}`,
)

/** Not normalised. */
export const tangentFallback = wgslFn(
  'tangentFallback',
  [],
  'fn tangentFallback(N:vec3f)->vec3f{return cross(select(vec3f(0.0,1.0,0.0),vec3f(0.0,0.0,1.0),abs(N.z)<0.999),N);}',
)

export const tangentBillboard = wgslFn(
  'tangentBillboard',
  [],
  'fn tangentBillboard(toEye:vec3f)->vec3f{return normalize(cross(select(vec3f(0, 1, 0), vec3f(1, 0, 0), abs(toEye.y) > 0.99), toEye));}',
)

/** Not normalised. */
export const tangentSide = wgslFn(
  'tangentSide',
  [],
  'fn tangentSide(N:vec3f)->vec3f{return cross(N,select(vec3f(1.0,0.0,0.0),vec3f(0.0,1.0,0.0),abs(N.x)>0.9));}',
)

/** Not normalised: across `x` unless `N.x` is within 1e-6 of zero, so `√(1 − N.x²)` long, null
 *  along ±x. */
export const tangentAcross = wgslFn(
  'tangentAcross',
  [],
  'fn tangentAcross(N:vec3f)->vec3f{return cross(N,select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),abs(N.x)>1e-6));}',
)

/** An orthonormal frame, its rows `x`, `y`, `z`. */
export const Frame3 = wgslStruct('Frame3', [], 'struct Frame3{x:vec3f,y:vec3f,z:vec3f,}')

/** The orthonormal frame whose `z` is the unit `axis`, with no branch: the sign of `axis.z` picks
 *  the hemisphere's formula, so `1/(s + z)` never divides by less than 1. */
export const frameAround = wgslFn(
  'frameAround',
  [Frame3],
  `fn frameAround(axis:vec3f)->Frame3{
 let s=select(-1.0,1.0,axis.z>=0.0);
 let a=-1.0/(s+axis.z);
 let b=axis.x*axis.y*a;
 return Frame3(vec3f(1.0+s*a*axis.x*axis.x,s*b,-s*axis.x),vec3f(b,s+a*axis.y*axis.y,-axis.y),axis);
}`,
)

/** The frame of `tangentAround(N)`: its `x` that tangent, its `y` `cross(N, x)`, its `z` `N`. */
export const tangentFrame = wgslFn(
  'tangentFrame',
  [Frame3, tangentAround],
  'fn tangentFrame(N:vec3f)->Frame3{let T=tangentAround(N);return Frame3(T,cross(N,T),N);}',
)

/** The vector `v` in the frame `m`: its dot with each of the frame's rows. */
export const intoFrame = wgslFn(
  'intoFrame',
  [Frame3],
  'fn intoFrame(m:Frame3,v:vec3f)->vec3f{return vec3f(dot(m.x,v),dot(m.y,v),dot(m.z,v));}',
)

/** The components `v` in the frame `m` back in the world: the rows weighted by them. */
export const outOfFrame = wgslFn(
  'outOfFrame',
  [Frame3],
  'fn outOfFrame(v:vec3f,m:Frame3)->vec3f{return v.x*m.x+v.y*m.y+v.z*m.z;}',
)
