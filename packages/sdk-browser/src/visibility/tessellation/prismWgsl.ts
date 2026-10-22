import { wgslBlock, wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { cofactor3, worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL } from '../shader/pageGeometryWgsl.ts'
import { TESSELLATED_FLAGS_WGSL } from './rowWgsl.ts'

/**
 * WHERE A DISPLACED PIXEL IS ON ITS TRIANGLE. The visibility buffer holds the source triangle of a
 * displaced pixel, not the point of it the pixel shows: the micro-triangle that won it lies off the
 * source triangle's plane. The resolve therefore solves the displaced prism: the point the pixel's
 * surface position (from the depth the tessellation wrote) is, in the weights of the three
 * corners each pushed along its normal by the one distance that carries the triangle through that
 * position. Two rounds — a closest point on the triangle, its interpolated normal, the distance the
 * position lies along it, the corners moved by it — then the weights of the position on the final
 * triangle; the weights at the next pixel in x and in y are those of the ray through it, meeting
 * the same triangle. All in the object's own space, where the normals are the geometry's.
 */

/** The binding numbers a displaced class adds to the resolve's group (`visibility/passes/shadeLayout.ts`):
 *  the depth the visibility buffer resolved to and `PrismUni`. The classes that draw no displaced
 *  pixel bind neither. */
export const DISPLACED_SHADE_BINDINGS = { depth: 23, prism: 24 } as const

/** What the solve reads of the view, once an image: the inverse of the resolve's `viewProj`, the eye
 *  in the same world, the pixels the view draws, and whether the frame tessellated. */
export const PRISM_UNIFORM = fieldLayout('PrismUni', [
  ['invViewProj', 'mat4x4f'],
  ['eye', 'vec3f'],
  ['tessellation', 'u32'],
  ['viewport', 'vec2f'],
] as const)

/** The weights of a pixel on its triangle, their steps to the next pixel in x and in y, and whether
 *  the solve holds (a position the depth places, a world that inverts). */
const PRISM_SOLVE = wgslStruct(
  'PrismSolve',
  [],
  'struct PrismSolve{value:vec3f,dx:vec3f,dy:vec3f,ok:bool,}',
)

/** The weights of the point where the ray `o + t * rd` meets the triangle `(v0, v1, v2)`. */
export const rayTriangleWeights = wgslFn(
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
export const closestPointWeights = wgslFn(
  'closestPointWeights',
  [rayTriangleWeights],
  `fn closestPointWeights(p:vec3f,v0:vec3f,v1:vec3f,v2:vec3f)->vec3f{
 return rayTriangleWeights(p,cross(v2-v0,v1-v0),v0,v1,v2);
}`,
)

/** The weights of a pixel on its triangle once the prism is solved, and whether the solve holds. */
const PRISM_VALUE = wgslStruct('PrismValue', [], 'struct PrismValue{value:vec3f,ok:bool,}')

/**
 * The corners of the displaced triangle that carries the pixel `pixel`: two rounds, each the closest
 * point of the triangle to the pixel along its normal held to the triangle (the weights clamped to
 * zero and made to sum to one), the normal interpolated there, the distance the pixel lies along
 * it, and the three corners moved by that distance. `position` and `normal` hold the triangle's
 * corners and normals in the object's space.
 */
export const prismCorners = wgslFn(
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
  [PRISM_VALUE, prismCorners],
  `fn prismValue(pixel:vec3f,position:mat3x3f,normal:mat3x3f)->PrismValue{
 let c=prismCorners(pixel,position,normal);
 let value=closestPointWeights(pixel,c[0],c[1],c[2]);
 return PrismValue(value,abs(value.x+value.y+value.z-1.0)<0.01);
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
 return PrismSolve(value,dx,dy,abs(value.x+value.y+value.z-1.0)<0.01);
}`,
)

/** The inverse of the 3×3 of columns `m`, by cofactors: the cofactors' columns are the adjugate's
 *  rows. Infinite where the matrix has no inverse: the caller tests `determinant`. */
export const inverse3 = wgslFn(
  'inverse3',
  [cofactor3],
  `fn inverse3(m:mat3x3f)->mat3x3f{
 let c=cofactor3(m[0],m[1],m[2]);
 let k=1.0/dot(m[0],c[0]);
 return mat3x3f(vec3f(c[0].x,c[1].x,c[2].x)*k,vec3f(c[0].y,c[1].y,c[2].y)*k,vec3f(c[0].z,c[1].z,c[2].z)*k);
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

/** The corners and the normals of a triangle, in the object's space as the frame deforms them. */
const PRISM_TRIANGLE = wgslStruct(
  'PrismTriangle',
  [],
  'struct PrismTriangle{position:mat3x3f,normal:mat3x3f,}',
)
/** Triangle `tri` of `page`, read as every pass reads it (`pagePosition`, `pageNormal`). */
export const prismTriangle = wgslFn(
  'prismTriangle',
  [PRISM_TRIANGLE, PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL],
  `fn prismTriangle(page:PageInfo,tri:u32)->PrismTriangle{
 let h=pageHeader(page);let k=pageTriangle(page,h,tri);
 let normal=mat3x3f(pageNormal(page,h,k.x),pageNormal(page,h,k.y),pageNormal(page,h,k.z));
 return PrismTriangle(pageTrianglePositions(page,h,k),normal);
}`,
)

/**
 * The point of the flat triangle `tri` of `page` that the displaced pixel at `at` stands over: the
 * weights the prism solve gives the pixel (`prismValue`) on the corners, taken into the world.
 * `at` is the pixel's position and `translation` the placement's, both relative to the same origin
 * (the world's, or the eye's); `w` is one where the solve holds, zero — and no point — where the
 * placement does not invert or the position lies on no prism.
 */
export const displacedFlat = wgslFn(
  'displacedFlat',
  [worldMatrix3, inverse3, prismValue, prismTriangle],
  `fn displacedFlat(page:PageInfo,tri:u32,at:vec3f,translation:vec3f)->vec4f{
 let linear=worldMatrix3(page.world);
 if(abs(determinant(linear))<1e-20){return vec4f(0.0);}
 let t=prismTriangle(page,tri);
 let solved=prismValue(inverse3(linear)*(at-translation),t.position,t.normal);
 if(!solved.ok){return vec4f(0.0);}
 return vec4f(linear*(t.position*solved.value)+translation,1.0);
}`,
)

/**
 * What the resolve of a displaced class adds to its text (`shadeShader`'s `displaced`): the depth
 * and the view's numbers, and `solveDisplaced`, the weights of the pixel `pos` of triangle `tri` of
 * `page` on the displaced triangle, read from the page's own corners and normals. A class that draws
 * no displaced pixel never compiles it.
 */
export const DISPLACED_PIXEL_WGSL = wgslBlock(
  'DISPLACED_PIXEL_WGSL',
  [worldMatrix3, inverse3, prismPixel, prismWeights, prismTriangle, TESSELLATED_FLAGS_WGSL],
  `${PRISM_UNIFORM.wgsl}
@group(0) @binding(${DISPLACED_SHADE_BINDINGS.depth}) var prismDepth:texture_depth_2d;
@group(0) @binding(${DISPLACED_SHADE_BINDINGS.prism}) var<uniform> prism:PrismUni;
fn solveDisplaced(page:PageInfo,tri:u32,pos:vec2f)->PrismSolve{
 let depth=textureLoad(prismDepth,vec2i(pos),0);
 let linear=worldMatrix3(page.world);
 let det=determinant(linear);
 if(!(depth>0.0)||abs(det)<1e-20){return PrismSolve(vec3f(0.0),vec3f(0.0),vec3f(0.0),false);}
 let px=prismPixel(page.world,inverse3(linear),prism.invViewProj,prism.eye,prism.viewport,pos,depth);
 let t=prismTriangle(page,tri);
 return prismWeights(px.eye,px.at,px.atX,px.atY,t.position,t.normal);
}`,
)
