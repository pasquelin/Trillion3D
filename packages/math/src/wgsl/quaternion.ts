import { wgslFn } from './decl.ts'

/**
 * The rotation of the quaternion `q = (x, y, z, w)`, row by row: column `r` of the result is row `r`
 * of the 3×3 rotation, so `rows[r].c` is its element at row `r`, column `c`. The shader twin of
 * `composeMatrix4At` (`matrix/matrix4Compose.ts`), which writes the same elements with the factor two
 * taken at another place of each product.
 */
export const quaternionRows = wgslFn(
  'quaternionRows',
  [],
  `fn quaternionRows(q:vec4f)->mat3x3f{
 let x=q.x;let y=q.y;let z=q.z;let w=q.w;
 return mat3x3f(
  vec3f(1.0-2.0*(y*y+z*z),2.0*(x*y-w*z),2.0*(x*z+w*y)),
  vec3f(2.0*(x*y+w*z),1.0-2.0*(x*x+z*z),2.0*(y*z-w*x)),
  vec3f(2.0*(x*z-w*y),2.0*(y*z+w*x),1.0-2.0*(x*x+y*y)));
}`,
)
