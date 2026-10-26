import { wgslBlock, wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { inverse3, worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL } from '../shader/pageGeometryWgsl.ts'
import { TESSELLATED_FLAGS_WGSL } from './rowWgsl.ts'
import { prismValue, prismWeights, prismPixel } from './prismSolveWgsl.ts'

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
export const DISPLACED_SHADE_BINDINGS = { depth: 24, prism: 25 } as const

/** What the solve reads of the view, once an image: the inverse of the resolve's `viewProj`, the eye
 *  in the same world, the pixels the view draws, and whether the frame tessellated. */
export const PRISM_UNIFORM = fieldLayout('PrismUni', [
  ['invViewProj', 'mat4x4f'],
  ['eye', 'vec3f'],
  ['tessellation', 'u32'],
  ['viewport', 'vec2f'],
] as const)

/** The corners and the normals of a triangle, in the object's space as the frame deforms them. */
const PRISM_TRIANGLE = wgslStruct(
  'PrismTriangle',
  [],
  'struct PrismTriangle{position:mat3x3f,normal:mat3x3f,}',
)
/** Triangle `tri` of `page`, read as every pass reads it (`pagePosition`, `pageNormal`). */
const prismTriangle = wgslFn(
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
 * (the world's, or the eye's); `w` is one. The solve is the reference's, as it is: a position on no
 * prism, a placement that does not invert, a pixel with no depth give the weights they give.
 */
export const displacedFlat = wgslFn(
  'displacedFlat',
  [worldMatrix3, inverse3, prismValue, prismTriangle],
  `fn displacedFlat(page:PageInfo,tri:u32,at:vec3f,translation:vec3f)->vec4f{
 let linear=worldMatrix3(page.world);
 let t=prismTriangle(page,tri);
 let value=prismValue(inverse3(linear)*(at-translation),t.position,t.normal);
 return vec4f(linear*(t.position*value)+translation,1.0);
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
 let px=prismPixel(page.world,inverse3(worldMatrix3(page.world)),prism.invViewProj,prism.eye,prism.viewport,pos,depth);
 let t=prismTriangle(page,tri);
 return prismWeights(px.eye,px.at,px.atX,px.atY,t.position,t.normal);
}`,
)
