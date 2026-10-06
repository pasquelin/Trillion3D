import type {
  HostAttributes,
  HostMaterials,
} from '../../../../packages/sdk-browser/src/host/resources.ts'
import type { MatrixElements } from '../../../../packages/sdk-browser/src/math/matrixElements.ts'
import type { PageSurface } from '../../../../packages/sdk-browser/src/page/surface.ts'

/** Structural shape of a page record. Deliberately structural: no coupling to `packages/sdk-browser/src/page/selection/selection.ts`. */
export type BatchPage = {
  id: number
  url: string
  array?: Uint32Array
  triangles: number
  min: number[]
  max: number[]
  attributes: HostAttributes
  /** The engine's surface record, what everything on the way to the image reads. */
  material: PageSurface
  /** The host declaration the WebGL2 draw record hands back to the renderer that owns it. */
  declaration: HostMaterials
  transparent?: boolean
  sourceOrder?: number
  matrix: MatrixElements
  renderOrder: number
  /** Coplanar depth layer, 0 for a cluster the compiler left alone. */
  depthLayer?: number
}
