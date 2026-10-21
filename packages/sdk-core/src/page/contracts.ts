import type { GEOMETRY_PAGE_FORMAT_VERSION } from './format.ts'

/** The format every cluster page of a cache is written in (`docs/FORMAT.md`), declared once at
 *  the top of the manifest; the page header's magic and the sidecar version are the gates. */
export interface GeometryPageFormat {
  /** Page format version. */
  formatVersion: typeof GEOMETRY_PAGE_FORMAT_VERSION
  /** Always `'quantized'`. */
  codec: 'quantized'
}
/** A quantized cluster page (`WGP3`): `bytes` is what a reader keeps resident,
 *  `uncompressedBytes` what its float decode occupies. */
export interface GeometryPageDescriptor {
  /** Where it is read: for a page of a compile's container, its name in the page catalogue — the
   *  container's address and its offset there, `file#offset` (`geometryPageAddress`). */
  url: string
  /** A page of a compile's container: `bytes` from `offset` of the streaming bundle the catalogue
   *  names `url`, read, kept and dropped whole. Absent for a page served at an address of its
   *  own. */
  bundle?: { url: string; offset: number }
  /** Fingerprint of its bytes. */
  sha256: string
  /** Its size. */
  bytes: number
  /** Vertices. */
  vertexCount: number
  /** Indices. */
  indexCount: number
  /** Which attributes it carries. */
  flags: number
  /** Its size once unpacked. */
  uncompressedBytes: number
}
/** The catalogue name of the geometry page at `offset` of the container at `file`. */
export const geometryPageAddress = (file: string, offset: number) => `${file}#${offset}`
/** The catalogue name of the streaming bundle at `offset` of the container at `file`: never a
 *  page's, though its first page starts where it does. */
export const streamBundleAddress = (file: string, offset: number) => `${file}#bundle-${offset}`
