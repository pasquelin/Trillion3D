/** A quantized cluster page (`WGP3`, `docs/FORMAT.md`): `bytes` is what a reader keeps resident,
 *  `uncompressedBytes` what its float decode occupies. */
export interface GeometryPageDescriptor {
  url: string;
  sha256: string;
  bytes: number;
  formatVersion: 3;
  codec: 'quantized';
  vertexCount: number;
  indexCount: number;
  flags: number;
  uncompressedBytes: number;
}
/** The grid a primitive's pages were quantized on, and the largest displacement it caused. */
export interface PrimitiveQuantization {
  /** Position step is `2 ** positionExponent`, in object units. */
  positionExponent: number;
  positionStep: number;
  /** Texture coordinates sit on `2 ** uvExponent`. */
  uvExponent: number;
  /** Largest distance between a source position and its decoded value; null without pages. */
  maxPositionError: number | null;
}
