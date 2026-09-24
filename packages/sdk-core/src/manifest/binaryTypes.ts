import { EngineError, type Primitive, type ClusterManifest } from '../contracts/index.ts';
import { MANIFEST_BINARY_VERSION } from './binaryFormat.ts';

/** Where the binary sits and how a cluster, a packed page and a bundle name their object. */
export interface ManifestBinaryDescriptor {
  /** Format version. */
  version: number;
  /** Where the binary file is. */
  url: string;
  /** Fingerprint of its bytes. */
  sha256: string;
  /** Its size. */
  bytes: number;
  /** `{sha}` is replaced by the 64 hexadecimal characters of the object digest. */
  pageUrl: string;
  /** Address pattern of a geometry block. */
  geometryUrl: string;
  /** Address pattern of a stream bundle. */
  bundleUrl: string;
  /** Entries of the progressive-level section; zero when the source has no decodable image. */
  texturePreviews: number;
  /** Bytes of the pixel column: entries have no fixed stride, so their total is written here. */
  texturePreviewBytes: number;
  /** Bytes of each block column — the kept chains' tails, family by family — written here too. */
  texturePreviewBc7Bytes: number;
  /** Bytes of the ASTC block column. */
  texturePreviewAstcBytes: number;
}
/** A primitive's culling tree, counted instead of listed. */
export interface SlimCulling {
  /** Numbers per node. */
  stride: number;
  /** How many nodes. */
  count: number;
}
/** A primitive's group links, counted instead of listed. */
export interface SlimStructure {
  /** Format version. */
  version: number;
  /** How many groups. */
  groups: number;
  /** How many roots. */
  roots: number;
}
/** A primitive's stream bundles, counted instead of listed. */
export interface SlimStreams {
  /** Format version. */
  version: number;
  /** Bundles always kept. */
  pinned: number;
  /** Target bundle size. */
  bundleBytes: number;
  /** Largest dependency count of a bundle: the bound the compiler publishes. */
  maxDependencies: number;
  /** How many bundles. */
  pages: number;
}
/** Counts and constants a primitive needs to find its own slice of every column. */
export interface SlimPrimitiveBinary {
  /** How many pages. */
  pages: number;
  /** Its culling tree's counts. */
  culling?: SlimCulling | null;
  /** Its group links' counts. */
  structure?: SlimStructure | null;
  /** Its stream bundles' counts. */
  streams?: SlimStreams | null;
}
/** A primitive whose long lists live in the binary file. */
export type SlimPrimitive = Omit<Primitive, 'pages' | 'culling' | 'structure' | 'streams'> & {
  /** Where to find its lists. */
  binary: SlimPrimitiveBinary;
};
/** A manifest whose long lists live in a binary file beside it. */
export type SlimClusterManifest = Omit<ClusterManifest, 'primitives'> & {
  /** The binary file. */
  binary: ManifestBinaryDescriptor;
  /** Its primitives. */
  primitives: SlimPrimitive[];
};

/** Counts a descriptor must carry, and what a rejection names. */
const COUNT_KEYS = {
  texturePreviews: 'texture preview count',
  texturePreviewBytes: 'texture preview byte length',
  texturePreviewBc7Bytes: 'texture preview BC block byte length',
  texturePreviewAstcBytes: 'texture preview ASTC block byte length',
  bytes: 'byte length',
} as const;
type CountKey = keyof typeof COUNT_KEYS;

/** Whether a manifest keeps its long lists in a binary file. */
export function isBinaryManifest(value: { binary?: unknown }): boolean {
  const binary = value.binary;
  return (
    !!binary &&
    typeof binary === 'object' &&
    !Array.isArray(binary) &&
    typeof (binary as { url?: unknown }).url === 'string'
  );
}
/** Rejects a sidecar this build cannot read, before any byte is fetched. */
export function assertManifestBinary(binary: unknown): asserts binary is ManifestBinaryDescriptor {
  if (!binary || typeof binary !== 'object' || Array.isArray(binary))
    throw new EngineError('UNSUPPORTED_FORMAT', 'Manifest binary descriptor is not an object', {});
  const descriptor = binary as Partial<ManifestBinaryDescriptor>;
  if (descriptor.version !== MANIFEST_BINARY_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `Expected manifest binary version ${MANIFEST_BINARY_VERSION}, received ${String(descriptor.version)}`,
      { version: descriptor.version ?? null, expected: MANIFEST_BINARY_VERSION },
    );
  for (const key of ['url', 'sha256', 'pageUrl', 'geometryUrl', 'bundleUrl'] as const)
    if (typeof descriptor[key] !== 'string' || !descriptor[key])
      throw new EngineError('UNSUPPORTED_FORMAT', `Manifest binary descriptor misses ${key}`, {
        key,
      });
  for (const [key, what] of Object.entries(COUNT_KEYS) as Array<[CountKey, string]>) {
    const value = descriptor[key];
    if (!Number.isSafeInteger(value) || value! < 0)
      throw new EngineError('UNSUPPORTED_FORMAT', `Manifest binary descriptor has no ${what}`, {
        [key]: value ?? null,
      });
  }
  for (const key of ['pageUrl', 'geometryUrl', 'bundleUrl'] as const)
    if (!descriptor[key]!.includes('{sha}'))
      throw new EngineError(
        'UNSUPPORTED_FORMAT',
        `Manifest binary template ${key} has no {sha} placeholder`,
        { key, template: descriptor[key] },
      );
}

/** The counts and constants a primitive needs to find its own slice of every column. */
export function slimBinaryOf(primitive: {
  pages: { length: number };
  culling?: { stride: number; count: number } | null;
  structure?: { version: number; groups: { length: number }; roots: { length: number } } | null;
  streams?: {
    version: number;
    pinned: number;
    bundleBytes: number;
    maxDependencies: number;
    pages: { length: number };
  } | null;
}): SlimPrimitiveBinary {
  const slim: SlimPrimitiveBinary = { pages: primitive.pages.length };
  if (primitive.culling !== undefined)
    slim.culling =
      primitive.culling === null
        ? null
        : { stride: primitive.culling.stride, count: primitive.culling.count };
  if (primitive.structure !== undefined)
    slim.structure =
      primitive.structure === null
        ? null
        : {
            version: primitive.structure.version,
            groups: primitive.structure.groups.length,
            roots: primitive.structure.roots.length,
          };
  if (primitive.streams !== undefined)
    slim.streams =
      primitive.streams === null
        ? null
        : {
            version: primitive.streams.version,
            pinned: primitive.streams.pinned,
            bundleBytes: primitive.streams.bundleBytes,
            maxDependencies: primitive.streams.maxDependencies,
            pages: primitive.streams.pages.length,
          };
  return slim;
}
