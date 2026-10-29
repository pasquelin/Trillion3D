import { wgslConst, wgslFn, wgslStruct } from './decl.ts'

/**
 * A RECTANGLE LIGHT SEEN FROM A POINT, SAMPLED BY THE SOLID ANGLE IT COVERS (`SphericalRect`): the rectangle with half sides `half` in the frame (`axis0` across, `axis1` down, `axis2` the
 * direction its face looks away from, which faces the point) whose centre is `toLight` from the point, projected to the sphere about the point and sampled in proportion to its area there, which
 * the corners' angles give in closed form (an area-preserving parametrization of the spherical rectangle).
 *
 * - `buildSphericalRect(toLight, axis0, axis1, axis2, half)` puts the point in the rectangle's frame (the rectangle on the plane `z0` below it, `z0` held negative by turning `axis2` where the
 *   point is behind) and takes the angles of the four corners' planes (`sphericalRectAsin`, an arcsine fitted for accuracy near 1, so that a far, small rectangle keeps its solid angle):
 *   its solid angle and the terms `b0`, `b1` and `k` the sampling inverts;
 * - `sphericalRectInversePdf(direction, distanceSquared, rect)` is the solid angle where it is over a thousandth of a steradian; under it the rectangle is sampled by area, and the
 *   inverse density is its area times the cosine at its face over the squared distance;
 * - `sampleSphericalRect(e, rect)` is a point of the rectangle drawn evenly in that solid angle (by area under the threshold): its direction, distance and inverse density, the
 *   coordinates `xu` and `yv` clamped to the rectangle so that no division by a vanishing sine leaves it.
 */
export const SphericalRect = wgslStruct(
  'SphericalRect',
  [],
  `struct SphericalRect{axis0:vec3f,axis1:vec3f,axis2:vec3f,x0:f32,x1:f32,y0:f32,y1:f32,z0:f32,b0:f32,b1:f32,k:f32,solid:f32,}`,
)

/** What a draw on the rectangle gives: the direction to its point, the distance and the inverse density. */
export const RectSample = wgslStruct(
  'RectSample',
  [],
  `struct RectSample{direction:vec3f,distance:f32,invPdf:f32,}`,
)

/** The solid angle under which the rectangle is sampled by area. */
export const RECT_MIN_SOLID_ANGLE = wgslConst(
  'RECT_MIN_SOLID_ANGLE',
  [],
  'const RECT_MIN_SOLID_ANGLE:f32=1.0e-3;',
)

/** The arcsine fitted for accuracy near 1. */
export const sphericalRectAsin = wgslFn(
  'sphericalRectAsin',
  [],
  `fn sphericalRectAsin(x:f32)->f32{
 let reduced=saturate(abs(x));
 let inner=reduced<0.5;
 let a2=select(0.5-0.5*reduced,reduced*reduced,inner);
 let a=select(sqrt(a2),reduced,inner);
 var r=0.100323;
 r=r*a2+0.163288;
 r=(r*a2+1.00011)*a;
 r=select(1.5707963267948966-2.0*r,r,inner);
 return select(r,-r,x<0.0);
}`,
)

/** The rectangle seen from the point. */
export const buildSphericalRect = wgslFn(
  'buildSphericalRect',
  [SphericalRect, sphericalRectAsin],
  `fn buildSphericalRect(toLight:vec3f,axis0:vec3f,axis1:vec3f,axis2:vec3f,half:vec2f)->SphericalRect{
 var rect:SphericalRect;
 let local=vec3f(dot(axis0,toLight),dot(axis1,toLight),dot(axis2,toLight));
 rect.axis0=axis0;
 rect.axis1=axis1;
 rect.axis2=select(axis2,-axis2,local.z>0.0);
 rect.x0=local.x-half.x;
 rect.x1=local.x+half.x;
 rect.y0=local.y-half.y;
 rect.y1=local.y+half.y;
 rect.z0=-abs(local.z);
 let z0sq=local.z*local.z;
 let n0z=-rect.y0*inverseSqrt(z0sq+rect.y0*rect.y0);
 let n1z=rect.x1*inverseSqrt(z0sq+rect.x1*rect.x1);
 let n2z=rect.y1*inverseSqrt(z0sq+rect.y1*rect.y1);
 let n3z=-rect.x0*inverseSqrt(z0sq+rect.x0*rect.x0);
 let g01=sphericalRectAsin(n0z*n1z)+sphericalRectAsin(n1z*n2z);
 let g23=sphericalRectAsin(n2z*n3z)+sphericalRectAsin(n3z*n0z);
 rect.b0=n0z;
 rect.b1=n2z;
 rect.k=g23;
 rect.solid=g01+g23;
 return rect;
}`,
)

/** The inverse density of the direction. */
export const sphericalRectInversePdf = wgslFn(
  'sphericalRectInversePdf',
  [SphericalRect, RECT_MIN_SOLID_ANGLE],
  `fn sphericalRectInversePdf(direction:vec3f,distanceSquared:f32,rect:SphericalRect)->f32{
 if(rect.solid>RECT_MIN_SOLID_ANGLE){return rect.solid;}
 return (rect.y1-rect.y0)*(rect.x1-rect.x0)*abs(dot(direction,rect.axis2))/distanceSquared;
}`,
)

/** A point of the rectangle. */
export const sampleSphericalRect = wgslFn(
  'sampleSphericalRect',
  [SphericalRect, RectSample, RECT_MIN_SOLID_ANGLE, sphericalRectInversePdf],
  `fn sampleSphericalRect(e:vec2f,rect:SphericalRect)->RectSample{
 var xu=mix(rect.x0,rect.x1,e.x);
 var yv=mix(rect.y0,rect.y1,e.y);
 if(rect.solid>RECT_MIN_SOLID_ANGLE){
  let au=e.x*rect.solid-rect.k;
  let fu=(cos(au)*rect.b0+rect.b1)/sin(au);
  var cu=inverseSqrt(fu*fu+rect.b0*rect.b0)*select(-1.0,1.0,fu>0.0);
  cu=clamp(cu,-1.0,1.0);
  xu=clamp(-(cu*rect.z0)*inverseSqrt(max(1.0-cu*cu,1e-30)),rect.x0,rect.x1);
  let d2=xu*xu+rect.z0*rect.z0;
  let h0=rect.y0*inverseSqrt(d2+rect.y0*rect.y0);
  let h1=rect.y1*inverseSqrt(d2+rect.y1*rect.y1);
  let hv=h0+e.y*(h1-h0);
  let rv=1.0-hv*hv;
  yv=select(rect.y1,hv*d2*inverseSqrt(rv*d2),rv>0.0);
 }
 var out:RectSample;
 let toPoint=xu*rect.axis0+yv*rect.axis1+rect.z0*rect.axis2;
 let distanceSquared=xu*xu+yv*yv+rect.z0*rect.z0;
 let inverseDistance=inverseSqrt(distanceSquared);
 out.distance=distanceSquared*inverseDistance;
 out.direction=toPoint*inverseDistance;
 out.invPdf=sphericalRectInversePdf(out.direction,distanceSquared,rect);
 return out;
}`,
)
