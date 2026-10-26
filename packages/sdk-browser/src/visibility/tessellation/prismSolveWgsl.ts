import { wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'

/** The weights of a pixel on its triangle, and their steps to the next pixel in x and in y. */
const PRISM_SOLVE = wgslStruct(
  'PrismSolve',
  [],
  'struct PrismSolve{value:vec3f,dx:vec3f,dy:vec3f,}',
)

/** The weights of the point where the ray `o + t * rd` meets the triangle `(v0, v1, v2)`. */
const rayTriangleWeights = wgslFn(
  'rayTriangleWeights',
  [],
  `fn rayTriangleWeights(o:vec3f,rd:vec3f,v0:vec3f,v1:vec3f,v2:vec3f)->vec3f{
 let e01=v1-v0;let e02=v2-v0;let o0=o-v0;
 let d=cross(rd,e02);
 let inv=1.0/dot(e01,d);
 let y=inv*dot(o0,d);
 let z=inv*dot(rd,cross(o0,e01));
 return vec3f(1.0-y-z,y,z);
}`,
)

/** The weights of the point of the triangle `(v0, v1, v2)` nearest to `p` along its normal. */
const closestPointWeights = wgslFn(
  'closestPointWeights',
  [rayTriangleWeights],
  `fn closestPointWeights(p:vec3f,v0:vec3f,v1:vec3f,v2:vec3f)->vec3f{
 return rayTriangleWeights(p,cross(v2-v0,v1-v0),v0,v1,v2);
}`,
)

/**
 * The corners of the displaced triangle that carries the pixel `pixel`: two rounds, each the closest
 * point of the triangle to the pixel along its normal held to the triangle (the weights clamped to
 * zero and made to sum to one), the normal interpolated there, the distance the pixel lies along
 * it, and the three corners moved by that distance. `position` and `normal` hold the triangle's
 * corners and normals in the object's space.
 */
const prismCorners = wgslFn(
  'prismCorners',
  [closestPointWeights],
  `fn prismCorners(pixel:vec3f,position:mat3x3f,normal:mat3x3f)->mat3x3f{
 var p0=position[0];var p1=position[1];var p2=position[2];
 for(var round=0u;round<2u;round++){
  var w=closestPointWeights(pixel,p0,p1,p2);
  w=max(w,vec3f(0.0));
  w=w/(w.x+w.y+w.z);
  let closest=p0*w.x+p1*w.y+p2*w.z;
  let n=normal[0]*w.x+normal[1]*w.y+normal[2]*w.z;
  let push=dot(pixel-closest,n)/dot(n,n);
  p0+=normal[0]*push;p1+=normal[1]*push;p2+=normal[2]*push;
 }
 return mat3x3f(p0,p1,p2);
}`,
)

/** The weights of `pixel` on the triangle `position`, `normal` displaced to carry it
 *  (`prismCorners`): where the pixel lies on the displaced surface, in the weights of its source
 *  triangle. */
export const prismValue = wgslFn(
  'prismValue',
  [prismCorners],
  `fn prismValue(pixel:vec3f,position:mat3x3f,normal:mat3x3f)->vec3f{
 let c=prismCorners(pixel,position,normal);
 return closestPointWeights(pixel,c[0],c[1],c[2]);
}`,
)

/**
 * The solve of the displaced prism: `position` and `normal` hold the triangle's corners and normals
 * in the object's space, `pixel` the surface position of the pixel and `pixelX`, `pixelY` those of
 * its neighbours in the same space, `camera` the eye.
 */
export const prismWeights = wgslFn(
  'prismWeights',
  [PRISM_SOLVE, prismCorners, closestPointWeights, rayTriangleWeights],
  `fn prismWeights(camera:vec3f,pixel:vec3f,pixelX:vec3f,pixelY:vec3f,position:mat3x3f,normal:mat3x3f)->PrismSolve{
 let c=prismCorners(pixel,position,normal);
 let value=closestPointWeights(pixel,c[0],c[1],c[2]);
 let dx=rayTriangleWeights(camera,pixelX-camera,c[0],c[1],c[2])-value;
 let dy=rayTriangleWeights(camera,pixelY-camera,c[0],c[1],c[2])-value;
 return PrismSolve(value,dx,dy);
}`,
)

/** A pixel's positions in the object's space (`world` its placement, `inverse` the inverse of its
 *  linear part): its own at `depth`, its neighbours' at the same depth — the step of one pixel
 *  taken as a homogeneous vector and divided by the pixel's own `w` —, and the eye. */
const PRISM_PIXEL = wgslStruct(
  'PrismPixel',
  [],
  'struct PrismPixel{at:vec3f,atX:vec3f,atY:vec3f,eye:vec3f,}',
)

export const prismPixel = wgslFn(
  'prismPixel',
  [PRISM_PIXEL],
  `fn prismPixel(world:mat4x4f,inverse:mat3x3f,invViewProj:mat4x4f,eye:vec3f,viewport:vec2f,pixel:vec2f,depth:f32)->PrismPixel{
 let ndc=vec4f(pixel.x/viewport.x*2.0-1.0,1.0-pixel.y/viewport.y*2.0,depth,1.0);
 let h=invViewProj*ndc;
 let hx=invViewProj*vec4f(2.0/viewport.x,0.0,0.0,0.0);
 let hy=invViewProj*vec4f(0.0,-2.0/viewport.y,0.0,0.0);
 let t=world[3].xyz;
 let at=inverse*(h.xyz-t*h.w);
 let dx=inverse*(hx.xyz-t*hx.w);
 let dy=inverse*(hy.xyz-t*hy.w);
 return PrismPixel(at/h.w,(at+dx)/h.w,(at+dy)/h.w,inverse*(eye-t));
}`,
)
