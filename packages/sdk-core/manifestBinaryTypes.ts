import { EngineError, type Primitive, type ClusterManifest } from './contracts.ts';
import { MANIFEST_BINARY_VERSION } from './manifestBinaryFormat.ts';

/** Where the binary sits and how a cluster, a packed page and a bundle name their object. */
export interface ManifestBinaryDescriptor {
  version: number;
  url: string;
  sha256: string;
  bytes: number;
  /** `{sha}` is replaced by the 64 hexadecimal characters of the object digest. */
  pageUrl: string;
  geometryUrl: string;
  bundleUrl: string;
  /** Entries of the progressive-level section; zero when the source has no decodable image. */
  texturePreviews: number;
  /** Bytes of the pixel column: entries have no fixed stride, so their total is written here. */
  texturePreviewBytes: number;
}
interface SlimCulling {
  stride: number;
  count: number;
}
interface SlimStructure {
  version: number;
  groups: number;
  roots: number;
}
interface SlimStreams {
  version: number;
  pinned: number;
  bundleBytes: number;
  pages: number;
}
/** Counts and constants a primitive needs to find its own slice of every column. */
export interface SlimPrimitiveBinary {
  pages: number;
  culling?: SlimCulling | null;
  structure?: SlimStructure | null;
  streams?: SlimStreams | null;
}
export type SlimPrimitive = Omit<Primitive, 'pages' | 'culling' | 'structure' | 'streams'> & {
  binary: SlimPrimitiveBinary;
};
export type SlimClusterManifest = Omit<ClusterManifest, 'primitives'> & {
  binary: ManifestBinaryDescriptor;
  primitives: SlimPrimitive[];
};

/** Counts a descriptor must carry, and what a rejection names. */
const COUNT_KEYS = {
  texturePreviews: 'texture preview count',
  texturePreviewBytes: 'texture preview byte length',
  bytes: 'byte length',
} as const;
type CountKey = keyof typeof COUNT_KEYS;

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
            pages: primitive.streams.pages.length,
          };
  return slim;
}
