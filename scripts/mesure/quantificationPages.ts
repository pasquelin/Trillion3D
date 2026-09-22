/**
 * How far a cache's decoded geometry pages sit from the source attributes the witnesses read.
 *
 * The autonomous WebGL2 path draws what `decodeGeometryPage` hands back — positions on the
 * primitive's quantization grid, normals as octahedral bytes (`docs/FORMAT.md`) — where every
 * other path reads the float attributes of `source.bin`. Same renderer, same materials, same
 * lights: this file measures the one input that is not the same, corner by corner, so that an
 * image difference between the two can be attributed instead of guessed.
 *
 *     node scripts/mesure/quantificationPages.ts <cache>/native/full
 *
 * Prints JSON: pages read, corners compared, largest and mean position gap in scene units, and
 * largest and mean angle between the decoded normal and the source one.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeManifestBinary, type ClusterManifest } from '../../packages/sdk-core/index.ts';
import { decodeGeometryPage } from '../../packages/sdk-browser/geometryPage.ts';

const ITEMS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Manifest of a `native/full` cache, binary columns read back in. */
function readManifest(full: string) {
  const key = readdirSync(full).find((name) => name.length === 64);
  if (!key) throw new Error(`no cache key under ${full}`);
  const dir = join(full, key);
  const slim = JSON.parse(readFileSync(join(dir, 'clusters.json'), 'utf8'));
  const bytes = readFileSync(join(dir, 'clusters.bin'));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { dir, metadata: decodeManifestBinary(slim, buffer as ArrayBuffer) as ClusterManifest };
}

/** A float accessor of the source glTF, read straight out of `source.bin`. */
function accessorReader(dir: string) {
  const gltf = JSON.parse(readFileSync(join(dir, 'source.gltf'), 'utf8'));
  const bin = readFileSync(join(dir, 'source.bin'));
  return {
    gltf,
    read(index: number) {
      const accessor = gltf.accessors[index],
        view = gltf.bufferViews[accessor.bufferView];
      const start = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const floats = accessor.count * ITEMS[accessor.type as string];
      return new Float32Array(bin.buffer.slice(start, start + floats * 4));
    },
  };
}

export function measureCache(full: string) {
  const { dir, metadata } = readManifest(full);
  const { gltf, read } = accessorReader(dir);
  const objects = join(dir, '..', '..', 'objects');
  const file = (url: string) => {
    const bytes = readFileSync(join(objects, url.split('/').pop()!));
    return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  let pages = 0,
    corners = 0,
    maxPosition = 0,
    sumPosition = 0,
    maxAngle = 0,
    sumAngle = 0;
  for (const primitive of metadata.primitives) {
    const attributes = gltf.meshes[primitive.mesh].primitives[primitive.primitive].attributes;
    const position = read(attributes.POSITION);
    const normal = attributes.NORMAL === undefined ? undefined : read(attributes.NORMAL);
    for (const page of primitive.pages) {
      if (!page.geometry) continue;
      pages += 1;
      // The index page holds the source vertex of each corner, in the order the geometry page
      // renumbered them: corner `i` of one is corner `i` of the other.
      const packed = file(page.url);
      const indices = new Uint32Array(packed.buffer, packed.byteOffset, packed.byteLength / 4);
      const decoded = decodeGeometryPage(file(page.geometry.url));
      for (let i = 0; i < indices.length; i += 1) {
        const source = indices[i],
          vertex = decoded.indices[i];
        let gap = 0;
        for (let axis = 0; axis < 3; axis += 1)
          gap = Math.max(
            gap,
            Math.abs(decoded.attributes.position[vertex * 3 + axis] - position[source * 3 + axis]),
          );
        maxPosition = Math.max(maxPosition, gap);
        sumPosition += gap;
        if (normal && decoded.attributes.normal) {
          let dot = 0;
          for (let axis = 0; axis < 3; axis += 1)
            dot += decoded.attributes.normal[vertex * 3 + axis] * normal[source * 3 + axis];
          const angle = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
          maxAngle = Math.max(maxAngle, angle);
          sumAngle += angle;
        }
        corners += 1;
      }
    }
  }
  return {
    cache: full,
    pages,
    corners,
    maxPositionGap: maxPosition,
    meanPositionGap: sumPosition / corners,
    maxNormalGapDegrees: maxAngle,
    meanNormalGapDegrees: sumAngle / corners,
  };
}

if (process.argv[1]?.endsWith('quantificationPages.ts')) {
  const full = process.argv[2];
  if (!full) throw new Error('usage: quantificationPages.ts <cache>/native/full');
  console.log(JSON.stringify(measureCache(full), null, 2));
}
