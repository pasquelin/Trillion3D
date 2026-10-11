/** What a page is cut from: named source attributes, each `itemSize` floats a vertex. */

/** One source attribute as a mesh loader hands it: `array` holds `itemSize` floats per vertex. */
export interface PageAttribute {
  itemSize: number
  array: ArrayLike<number>
}

/** The attributes a page can be built from; `POSITION` is required. */
export interface PageAttributes {
  POSITION?: PageAttribute
  NORMAL?: PageAttribute
  TEXCOORD_0?: PageAttribute
  TEXCOORD_1?: PageAttribute
  /** Three or four wide; a three-wide colour takes alpha 1. */
  COLOR_0?: PageAttribute
  /** Joints and weights, read only with each other; a rank after the first adds its influences. */
  [key: `JOINTS_${number}`]: PageAttribute | undefined
  [key: `WEIGHTS_${number}`]: PageAttribute | undefined
}

/** A morph target handed to the encoder: its displacements per source vertex. */
export interface PageTarget {
  POSITION: PageAttribute
  NORMAL?: PageAttribute
}
