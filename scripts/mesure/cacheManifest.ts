// The manifest of a compiled cache — pointer, small JSON, sidecar columns — decoded whole, and
// the directory its files live in.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodeManifestBinary } from '../../packages/sdk-core/manifestBinary.ts';
import type { SlimClusterManifest } from '../../packages/sdk-core/manifestBinary.ts';
import type { ClusterManifest } from '../../packages/sdk-core/geometryContracts.ts';

/** The pointer `manifest.json`, naming the slim manifest JSON to read next to it. */
interface ManifestPointer {
  url: string;
}

/** `full` is `<cache>/native/full`, the directory of the pointer `manifest.json`. */
export function readCacheManifest(full: string): { dir: string; manifest: ClusterManifest } {
  const pointer = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as ManifestPointer;
  const clustersPath = join(full, pointer.url),
    dir = dirname(clustersPath);
  const slim = JSON.parse(readFileSync(clustersPath, 'utf8')) as SlimClusterManifest;
  const bin = readFileSync(join(dir, slim.binary.url));
  return {
    dir,
    manifest: decodeManifestBinary(
      slim,
      bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    ),
  };
}
