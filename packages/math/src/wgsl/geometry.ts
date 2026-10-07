import { wgslFn } from './decl.ts'

/**
 * Triangles, planes and rays, as the shaders compute them. A plane is a `vec4f`, its normal in
 * `xyz` and its offset in `w`, a point on its positive side where `dot(xyz, p) + w > 0`; nothing
 * here normalises it. A sine from its cosine is written two ways, floored at zero or not, each its
 * own rounding of a cosine past 1.
 */

/** The face normal of the triangle `p0, p1, p2`, not normalised: twice its area long, along the
 *  side from which the corners turn counter-clockwise. */
export const faceNormal = wgslFn(
  'faceNormal',
  [],
  'fn faceNormal(p0:vec3f,p1:vec3f,p2:vec3f)->vec3f{return cross(p1-p0,p2-p0);}',
)

/** The part of `v` across the unit normal `N`: `v` without its component along `N`. */
export const vectorRejection = wgslFn(
  'vectorRejection',
  [],
  'fn vectorRejection(v:vec3f,N:vec3f)->vec3f{return v-N*dot(N,v);}',
)

/** The sine of an angle in [0, π] from its cosine, 0 where a rounded cosine passes ±1. */
export const sinFromCos = wgslFn(
  'sinFromCos',
  [],
  'fn sinFromCos(c:f32)->f32{return sqrt(max(0.0,1.0-c*c));}',
)

/** The same, unfloored: a cosine known in [−1, 1]. */
export const sinFromCosUnclamped = wgslFn(
  'sinFromCosUnclamped',
  [],
  'fn sinFromCosUnclamped(c:f32)->f32{return sqrt(1.0-c*c);}',
)

/** The signed distance of `point` to `plane`, in units of the plane normal's length. */
export const planeDistance = wgslFn(
  'planeDistance',
  [],
  'fn planeDistance(plane:vec4f,point:vec3f)->f32{return dot(plane.xyz,point)+plane.w;}',
)

/** The corner of the box `[bmin, bmax]` furthest along the plane's normal; a NaN or zero component
 *  takes the low bound. The processor's twin is `frustumExcludesBox` (`../geometry/frustum/box.ts`). */
export const boxPositiveVertex = wgslFn(
  'boxPositiveVertex',
  [],
  'fn boxPositiveVertex(plane:vec4f,bmin:vec3f,bmax:vec3f)->vec3f{return vec3f(select(bmin.x,bmax.x,plane.x>0.0),select(bmin.y,bmax.y,plane.y>0.0),select(bmin.z,bmax.z,plane.z>0.0));}',
)

/** How far the box reaches past the plane: its positive corner's signed distance. */
export const boxPlaneDistance = wgslFn(
  'boxPlaneDistance',
  [planeDistance, boxPositiveVertex],
  'fn boxPlaneDistance(plane:vec4f,bmin:vec3f,bmax:vec3f)->f32{return planeDistance(plane,boxPositiveVertex(plane,bmin,bmax));}',
)

/** True when the box lies wholly behind the plane; a NaN never culls. */
export const boxBehindPlane = wgslFn(
  'boxBehindPlane',
  [boxPlaneDistance],
  'fn boxBehindPlane(plane:vec4f,bmin:vec3f,bmax:vec3f)->bool{return boxPlaneDistance(plane,bmin,bmax)<0.0;}',
)

/** True when the sphere lies wholly behind the plane, whose normal is a unit vector. */
export const sphereBehindPlane = wgslFn(
  'sphereBehindPlane',
  [planeDistance],
  'fn sphereBehindPlane(plane:vec4f,centre:vec3f,radius:f32)->bool{return planeDistance(plane,centre)< -radius;}',
)

/** The reciprocal of a ray's direction for the slab test, a component under 1e-20 in magnitude
 *  taken as +1e-20: no division in a traversal's loop, and no infinity on a zero axis. */
export const rayInverseDirection = wgslFn(
  'rayInverseDirection',
  [],
  'fn rayInverseDirection(direction:vec3f)->vec3f{return vec3f(1.0)/select(direction,vec3f(1e-20),abs(direction)<vec3f(1e-20));}',
)

/** The slab test (`../geometry/slab.ts`, which divides where this multiplies by the reciprocal):
 *  where the ray from `origin`, its direction's reciprocal `inverse`, enters the box `[low, high]`,
 *  from 0 on, or `limit + 1` when it misses before `limit`. */
export const rayBoxEntry = wgslFn(
  'rayBoxEntry',
  [],
  `fn rayBoxEntry(low:vec3f,high:vec3f,origin:vec3f,inverse:vec3f,limit:f32)->f32{
 let first=(low-origin)*inverse;
 let second=(high-origin)*inverse;
 let near=min(first,second);
 let far=max(first,second);
 let entry=max(max(near.x,near.y),max(near.z,0.0));
 let exit=min(min(far.x,far.y),min(far.z,limit));
 return select(limit+1.0,entry,entry<=exit);
}`,
)

/** The ray–triangle intersection by the triple products of the edges, two-sided, with no plane
 *  stored: the distance along `direction`
 *  from `origin` to the triangle `a, b, c`, or `limit` when it misses — a determinant under 1e-12,
 *  a hit at or under 1e-4 or at or past `limit`. */
export const rayTriangleDistance = wgslFn(
  'rayTriangleDistance',
  [],
  `fn rayTriangleDistance(origin:vec3f,direction:vec3f,a:vec3f,b:vec3f,c:vec3f,limit:f32)->f32{
 let edge0=b-a;
 let edge1=c-a;
 let perpendicular=cross(direction,edge1);
 let determinant=dot(edge0,perpendicular);
 if(abs(determinant)<1e-12){return limit;}
 let inverse=1.0/determinant;
 let offset=origin-a;
 let u=dot(offset,perpendicular)*inverse;
 if(u<0.0||u>1.0){return limit;}
 let across=cross(offset,edge0);
 let v=dot(direction,across)*inverse;
 if(v<0.0||u+v>1.0){return limit;}
 let distance=dot(edge1,across)*inverse;
 if(distance<=1e-4||distance>=limit){return limit;}
 return distance;
}`,
)
