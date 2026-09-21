/**
 * Attribute schema of a source mesh handed to the encoder: which named attributes it may carry,
 * and the presence bit and page-cell field each optional one fills.
 */

/** One source attribute as a mesh loader hands it: `array` holds `itemSize` floats per vertex. */
export interface PageAttribute {
  itemSize: number;
  array: ArrayLike<number>;
}

/** The attributes a page can be built from; `POSITION` is required at run time. */
export interface PageAttributes {
  POSITION?: PageAttribute;
  NORMAL?: PageAttribute;
  TEXCOORD_0?: PageAttribute;
  TEXCOORD_1?: PageAttribute;
  COLOR_0?: PageAttribute;
}

export type OptionalAttributeName = 'NORMAL' | 'TEXCOORD_0' | 'TEXCOORD_1' | 'COLOR_0';

/** Source attribute, presence bit and the field of the page cell it fills. */
export const ATTRIBUTES: readonly [OptionalAttributeName, number, number][] = [
  ['NORMAL', 3, 1],
  ['TEXCOORD_0', 2, 2],
  ['TEXCOORD_1', 2, 4],
  ['COLOR_0', 4, 8],
];

/** One unique vertex of the page, before it is packed into streams. */
export interface PageCell {
  p: number[];
  n: number;
  uv: [number[], number[]];
  c: number[];
}
