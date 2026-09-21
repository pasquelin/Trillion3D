// The manifest of a compiled cache — pointer, small JSON, sidecar columns — decoded whole, and
// the directory its files live in.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodeManifestBinary } from '../../packages/sdk-core/manifestBinary.ts';

/** `full` is `<cache>/native/full`, the directory of the pointer `manifest.json`. */
export function readCacheManifest(full) {
  const pointer = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8'));
  const clustersPath = join(full, pointer.url),
    dir = dirname(clustersPath);
  const slim = JSON.parse(readFileSync(clustersPath, 'utf8'));
  const bin = readFileSync(join(dir, slim.binary.url));
  return {
    dir,
    manifest: decodeManifestBinary(
      slim,
      bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    ),
  };
}
