/** The format every cluster page of a cache is written in (`docs/FORMAT.md`), declared once at
 *  the top of the manifest; the page header's magic and the sidecar version are the gates. */
export interface GeometryPageFormat {
  /** Page format version. */
  formatVersion: 3;
  /** Always `'quantized'`. */
  codec: 'quantized';
}
/** A quantized cluster page (`WGP3`): `bytes` is what a reader keeps resident,
 *  `uncompressedBytes` what its float decode occupies. */
export interface GeometryPageDescriptor {
  /** Where it is read. */
  url: string;
  /** Fingerprint of its bytes. */
  sha256: string;
  /** Its size. */
  bytes: number;
  /** Vertices. */
  vertexCount: number;
  /** Indices. */
  indexCount: number;
  /** Which attributes it carries. */
  flags: number;
  /** Its size once unpacked. */
  uncompressedBytes: number;
}
/** The grid a primitive's pages were quantized on, and the largest displacement it caused. */
export interface PrimitiveQuantization {
  /** Position step is `2 ** positionExponent`, in object units. */
  positionExponent: number;
  /** Texture coordinates sit on `2 ** uvExponent`. */
  uvExponent: number;
  /** Largest distance between a source position and its decoded value; null without pages. */
  maxPositionError: number | null;
}
