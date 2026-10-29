import { wgslFn } from './decl.ts'
import { DIVISOR_FLOOR, PI } from './constants.ts'

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

/** A stored normal made unit, the straight-up `(0, 0, 1)` where it holds none (a pixel nothing wrote a normal to: the sky's zero). */
export const unitNormalOrUp = wgslFn(
  'unitNormalOrUp',
  [],
  `fn unitNormalOrUp(n:vec3f)->vec3f{
 let l=length(n);
 return select(vec3f(0.0,0.0,1.0),n/l,l>0.0);
}`,
)

/** The part of `v` across the unit normal `N`: `v` without its component along `N`. */
export const vectorRejection = wgslFn(
  'vectorRejection',
  [],
  'fn vectorRejection(v:vec3f,N:vec3f)->vec3f{return v-N*dot(N,v);}',
)

/** The sine of an angle in [0, π] from its cosine, a cosine known in [−1, 1]. */
export const sinFromCosUnclamped = wgslFn(
  'sinFromCosUnclamped',
  [],
  'fn sinFromCosUnclamped(c:f32)->f32{return sqrt(1.0-c*c);}',
)

/** The angle in [0, π] of a cosine `x`, to within 0.009 radians: Eberly's polynomial of degree one,
 *  `(0.5π − 0.156583·|x|)·√(1 − |x|)`, taken from π for a negative cosine. A cosine a hair past one — a dot product of unit
 *  vectors rounded up — is read as one: the root of a negative number would make the angle, and all it touches, not a number. */
export const fastAcos = wgslFn(
  'fastAcos',
  [PI],
  `fn fastAcos(x:f32)->f32{
 let a=min(abs(x),1.0);
 let r=(-0.156583*a+0.5*PI)*sqrt(1.0-a);
 return select(PI-r,r,x>=0.0);
}`,
)

/** The angle of a tangent `x` of at least 0, in [0, ½π): a minimax polynomial of degree three in `x` below 1; above it,
 *  ½π less the same polynomial of `1/x`. */
export const fastAtan = wgslFn(
  'fastAtan',
  [PI],
  `fn fastAtan(x:f32)->f32{
 let below=x<1.0;
 let a=select(1.0/x,x,below);
 let base=select(0.5*PI,0.0,below);
 let turn=select(-1.0,1.0,below);
 return base+turn*(((-0.130234*a-0.0954105)*a+1.00712)*a-0.00001203333);
}`,
)

/** The angle of the vector `(x, y)` in (−π, π], to within 0.0014 radian: the arctangent of the ratio of its smaller to its
 *  larger coordinate by an odd polynomial of degree five (`((0.0872929·t² − 0.301895)·t² + 1)·t`), taken from ½π where
 *  `y` is the larger, from π where `x` is negative, and negated where `y` is. At the origin the ratio is 0 over 0, which
 *  would make the angle not a number: it is 0 there, as the arctangent of two zeros is by convention. */
export const fastAtan2 = wgslFn(
  'fastAtan2',
  [PI],
  `fn fastAtan2(y:f32,x:f32)->f32{
 let larger=max(abs(x),abs(y));
 let smaller=min(abs(x),abs(y));
 let ratio=select(smaller/larger,0.0,larger==0.0);
 let squared=ratio*ratio;
 var angle=(((0.0872929*squared-0.301895)*squared)+1.0)*ratio;
 angle=select(angle,0.5*PI-angle,abs(y)>abs(x));
 angle=select(angle,PI-angle,x<0.0);
 return select(angle,-angle,y<0.0);
}`,
)

/** The signed distance of `point` to `plane`, in units of the plane normal's length. */
export const planeDistance = wgslFn(
  'planeDistance',
  [],
  'fn planeDistance(plane:vec4f,point:vec3f)->f32{return dot(plane.xyz,point)+plane.w;}',
)

/** The corner of the box `[bmin, bmax]` furthest along the plane's normal; a NaN or zero component
 *  takes the low bound. The processor's twin is `frustumExcludesBox` (`../geometry/frustum/box.ts`). */
const boxPositiveVertex = wgslFn(
  'boxPositiveVertex',
  [],
  'fn boxPositiveVertex(plane:vec4f,bmin:vec3f,bmax:vec3f)->vec3f{return vec3f(select(bmin.x,bmax.x,plane.x>0.0),select(bmin.y,bmax.y,plane.y>0.0),select(bmin.z,bmax.z,plane.z>0.0));}',
)

/** How far the box reaches past the plane: its positive corner's signed distance. */
const boxPlaneDistance = wgslFn(
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

/** The half extents `e` of a box carried by the linear part of `world`: per axis the absolute
 *  columns against them, `|world[0]|·e.x + |world[1]|·e.y + |world[2]|·e.z` (`transformHalfExtent`
 *  of `../geometry/box.ts`). */
export const transformHalfExtent = wgslFn(
  'transformHalfExtent',
  [],
  'fn transformHalfExtent(world:mat4x4f,e:vec3f)->vec3f{return abs(world[0].xyz)*e.x+abs(world[1].xyz)*e.y+abs(world[2].xyz)*e.z;}',
)

/** The reciprocal of a ray's direction for the slab test, a component under `DIVISOR_FLOOR` (1e-20)
 *  in magnitude taken as +1e-20: no division in a traversal's loop, and no infinity on a zero axis. */
export const rayInverseDirection = wgslFn(
  'rayInverseDirection',
  [DIVISOR_FLOOR],
  'fn rayInverseDirection(direction:vec3f)->vec3f{return vec3f(1.0)/select(direction,vec3f(DIVISOR_FLOOR),abs(direction)<vec3f(DIVISOR_FLOOR));}',
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

/** The slab test's whole span (`rayBoxEntry`, unbounded): where the ray from `origin`, its
 *  direction's reciprocal `inverse`, enters the box `[low, high]`, from 0 on, and where it
 *  leaves it — a span whose entry is not below its exit misses. */
export const rayBoxSpan = wgslFn(
  'rayBoxSpan',
  [],
  `fn rayBoxSpan(low:vec3f,high:vec3f,origin:vec3f,inverse:vec3f)->vec2f{
 let first=(low-origin)*inverse;
 let second=(high-origin)*inverse;
 let near=min(first,second);
 let far=max(first,second);
 return vec2f(max(max(near.x,near.y),max(near.z,0.0)),min(min(far.x,far.y),far.z));
}`,
)

/** The segment from `start` to `end` against the box `[low, high]`, as the fractions of the segment
 *  held in it: `rayBoxSpan` along `end - start`, saturated to [0, 1] — a span whose entry is not
 *  below its exit misses. */
export const segmentBoxSpan = wgslFn(
  'segmentBoxSpan',
  [rayBoxSpan, rayInverseDirection],
  'fn segmentBoxSpan(start:vec3f,end:vec3f,low:vec3f,high:vec3f)->vec2f{return saturate(rayBoxSpan(low,high,start,rayInverseDirection(end-start)));}',
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

/** How far along `direction` from `origin` the ray passes within `reach` of the segment `a, b`: the
 *  parameter of its point nearest the segment, or `limit` when it passes farther — or at or under
 *  1e-4, or at or past `limit`, as `rayTriangleDistance`. The segment's point nearest the ray's
 *  line, then the ray's point nearest that one, each clamped, twice: what a line with no area
 *  meets, within the reach a ray is given. */
export const raySegmentDistance = wgslFn(
  'raySegmentDistance',
  [],
  `fn raySegmentDistance(origin:vec3f,direction:vec3f,a:vec3f,b:vec3f,reach:f32,limit:f32)->f32{
 let edge=b-a;
 let dd=dot(direction,direction);
 let ee=dot(edge,edge);
 let de=dot(direction,edge);
 let offset=origin-a;
 let denominator=dd*ee-de*de;
 var s=0.0;
 if(denominator>1e-12*dd*ee){s=clamp((dd*dot(edge,offset)-de*dot(direction,offset))/denominator,0.0,1.0);}
 var t=max(0.0,dot(direction,a+edge*s-origin)/max(dd,1e-30));
 if(ee>0.0){s=clamp(dot(edge,origin+direction*t-a)/ee,0.0,1.0);}
 t=max(0.0,dot(direction,a+edge*s-origin)/max(dd,1e-30));
 let gap=origin+direction*t-(a+edge*s);
 if(dot(gap,gap)>reach*reach||t<=1e-4||t>=limit){return limit;}
 return t;
}`,
)
