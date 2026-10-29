import { EngineError } from '../contracts/cache.ts'
import type { Primitive, ClusterManifest } from '../contracts/geometry.ts'
import { MANIFEST_BINARY_VERSION } from '../contracts/writtenFormats.ts'

/** The last manifest binary version holding the texture previews' pixels in the head sidecar; later
 *  versions keep them in their own file (`texturePreviewPixels`), the sidecar's column empty. */
const INLINE_PIXELS_VERSION = 21

/** The manifest binary versions this build reads, newest first: every one from the inline-pixels one
 *  to the current one. */
export const READ_MANIFEST_VERSIONS: readonly number[] = Array.from(
  { length: MANIFEST_BINARY_VERSION - INLINE_PIXELS_VERSION + 1 },
  (_, back) => MANIFEST_BINARY_VERSION - back,
)

/** Whether this build reads a manifest binary of `version`. */
export function readsManifestBinaryVersion(version: unknown) {
  return READ_MANIFEST_VERSIONS.includes(version as number)
}

/** Where the binary sits, and the counts its columns are read by. */
export interface ManifestBinaryDescriptor {
  /** Format version. */
  version: number
  /** Where the binary file is. */
  url: string
  /** Fingerprint of its bytes. */
  sha256: string
  /** Its size. */
  bytes: number
  /** Entries of the progressive-level section; zero when the source has no decodable image. */
  texturePreviews: number
  /** Bytes of the pixel column: entries have no fixed stride, so their total is written here. */
  texturePreviewBytes: number
  /** Bytes of each block column — the kept chains' tails, family by family — written here too. */
  texturePreviewBc7Bytes: number
  /** Bytes of the ASTC block column. */
  texturePreviewAstcBytes: number
  /** Bytes of the ETC2 block column. */
  texturePreviewEtc2Bytes: number
  /** The file holding the pixel column's bytes when they are not in this sidecar, whose
   *  `texturePreviewBytes` is then 0; absent from a cache that keeps them inline. */
  texturePreviewPixels?: ClusterManifest['texturePreviewPixels']
}
/** A primitive's culling tree, counted instead of listed. */
export interface SlimCulling {
  /** Numbers per node. */
  stride: number
  /** How many nodes. */
  count: number
}
/** A primitive's group links, counted instead of listed. */
export interface SlimStructure {
  /** Format version. */
  version: number
  /** How many groups. */
  groups: number
  /** How many roots. */
  roots: number
}
/** A primitive's stream bundles, counted instead of listed. */
export interface SlimStreams {
  /** Format version. */
  version: number
  /** Bundles always kept. */
  pinned: number
  /** Target bundle size. */
  bundleBytes: number
  /** Most bundles holding the parents of one bundle's clusters, fixed before packing. */
  dependencyBound: number
  /** Longest closed dependency list of a bundle. */
  maxDependencies: number
  /** How many bundles. */
  pages: number
}
/** Counts and constants a primitive needs to find its own slice of every column. */
export interface SlimPrimitiveBinary {
  /** How many pages. */
  pages: number
  /** Its culling tree's counts. */
  culling?: SlimCulling | null
  /** Its group links' counts. */
  structure?: SlimStructure | null
  /** Its stream bundles' counts. */
  streams?: SlimStreams
}
/** A primitive whose long lists live in the binary file. */
export type SlimPrimitive = Omit<Primitive, 'pages' | 'culling' | 'structure' | 'streams'> & {
  /** Where to find its lists. */
  binary: SlimPrimitiveBinary
}
/** One geometry container of a compile: every geometry page lies in one, read by byte range. */
export interface GeometryFile {
  /** Where it is read, against the manifest. */
  url: string
  /** Fingerprint of its bytes. */
  sha256: string
  /** Its size. */
  bytes: number
}
/** A manifest whose long lists live in a binary file beside it. */
export type SlimClusterManifest = Omit<ClusterManifest, 'primitives'> & {
  /** The binary file. */
  binary: ManifestBinaryDescriptor
  /** The geometry containers its pages name by rank; none on the head page. */
  geometryFiles?: GeometryFile[]
  /** Its primitives. */
  primitives: SlimPrimitive[]
}

/** Counts a descriptor must carry, and what a rejection names. */
const COUNT_KEYS = {
  texturePreviews: 'texture preview count',
  texturePreviewBytes: 'texture preview byte length',
  texturePreviewBc7Bytes: 'texture preview BC block byte length',
  texturePreviewAstcBytes: 'texture preview ASTC block byte length',
  texturePreviewEtc2Bytes: 'texture preview ETC2 block byte length',
  bytes: 'byte length',
} as const
type CountKey = keyof typeof COUNT_KEYS

/** Rejects a sidecar this build cannot read, before any byte is fetched. */
export function assertManifestBinary(binary: unknown): asserts binary is ManifestBinaryDescriptor {
  if (!binary || typeof binary !== 'object' || Array.isArray(binary))
    throw new EngineError('UNSUPPORTED_FORMAT', 'Manifest binary descriptor is not an object', {})
  const descriptor = binary as Partial<ManifestBinaryDescriptor>
  if (!readsManifestBinaryVersion(descriptor.version))
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `Expected manifest binary version ${READ_MANIFEST_VERSIONS.join(', ')}, received ${String(descriptor.version)}`,
      { version: descriptor.version ?? null, expected: MANIFEST_BINARY_VERSION },
    )
  for (const key of ['url', 'sha256'] as const)
    if (typeof descriptor[key] !== 'string' || !descriptor[key])
      throw new EngineError('UNSUPPORTED_FORMAT', `Manifest binary descriptor misses ${key}`, {
        key,
      })
  for (const [key, what] of Object.entries(COUNT_KEYS) as Array<[CountKey, string]>) {
    const value = descriptor[key]
    if (!Number.isSafeInteger(value) || value! < 0)
      throw new EngineError('UNSUPPORTED_FORMAT', `Manifest binary descriptor has no ${what}`, {
        [key]: value ?? null,
      })
  }
  const file = descriptor.texturePreviewPixels
  // An inline-pixels cache has no pixel file; any later one holds none of the column in its sidecar.
  if (descriptor.version === INLINE_PIXELS_VERSION && file !== undefined)
    throw new EngineError(
      'INVALID_CACHE',
      `Manifest binary version ${INLINE_PIXELS_VERSION} keeps its previews' pixels inline`,
      { version: descriptor.version },
    )
  if (descriptor.version !== INLINE_PIXELS_VERSION && descriptor.texturePreviewBytes !== 0)
    throw new EngineError(
      'INVALID_CACHE',
      `Manifest binary version ${String(descriptor.version)} keeps no preview pixel in its sidecar`,
      { version: descriptor.version, texturePreviewBytes: descriptor.texturePreviewBytes },
    )
  if (file === undefined) return
  if (
    !file ||
    typeof file !== 'object' ||
    typeof file.url !== 'string' ||
    !file.url ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes <= 0 ||
    typeof file.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(file.sha256)
  )
    throw new EngineError('UNSUPPORTED_FORMAT', 'Manifest binary descriptor has a bad pixel file', {
      texturePreviewPixels: file ?? null,
    })
}
