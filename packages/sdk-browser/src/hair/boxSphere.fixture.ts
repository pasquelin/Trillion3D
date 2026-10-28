import type { BoxSphere } from './boxSphere.ts'

/** A copy of `bounds`. */
export const copyBoxSphere = (bounds: BoxSphere): BoxSphere => ({
  box: Float64Array.from(bounds.box),
  sphere: Float64Array.from(bounds.sphere),
})
