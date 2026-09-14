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
  if (!Number.isSafeInteger(descriptor.bytes) || descriptor.bytes! < 0)
    throw new EngineError('UNSUPPORTED_FORMAT', 'Manifest binary descriptor has no byte length', {
      bytes: descriptor.bytes ?? null,
    });
  for (const key of ['pageUrl', 'geometryUrl', 'bundleUrl'] as const)
    if (!descriptor[key]!.includes('{sha}'))
      throw new EngineError(
        'UNSUPPORTED_FORMAT',
        `Manifest binary template ${key} has no {sha} placeholder`,
        { key, template: descriptor[key] },
      );
}
