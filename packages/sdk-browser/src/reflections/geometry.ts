import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { reflectionBindingsWgsl } from './viewLayout.ts'

/**
 * The geometry of the view the reflection shares (the pixel's world point, the eye and the drawn
 * size are the deferred lighting's own: `worldAt`, `viewToEye`, `view.viewport`).
 *
 * `reflectionBack` is the depth of the point `pixels` pixels of footprint behind a surface at depth
 * `z`, along the eye's ray: affine in `z` and increasing with it, so that the back of the farthest
 * surface of a cell bounds the back of every surface of it. Under a perspective the thickness is
 * `k · w` of the surface's distance `w`, `k = pixels · scale`, and the depth `A + B / w`: its back
 * `A + B / (w · (1 + k)) = z − (z − A) · k / (1 + k)`, finite whatever `z`, never a point
 * projected. Under an orthographic projection the thickness is the same at every depth, and so is
 * the depth it spans. The surface's front is its mirror, `2 · z − back`.
 */
export const reflectionGeometryWgsl = (group: number) =>
  wgslBlock(
    `reflectionGeometryWgsl(${group})`,
    [reflectionBindingsWgsl(group)],
    `fn reflectionBack(z:f32,pixels:f32)->f32{
 let k=pixels*reflectionView.slab.x;
 let perspective=z-(z-reflectionView.slab.y)*k/(1.0+k);
 return select(z-pixels*reflectionView.slab.z,perspective,reflectionView.slab.w>0.5);
}`,
  )
