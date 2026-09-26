// The compiler cooks every cluster's normal cone (`asset-compiler-rust/src/normal_cone.rs`) and the
// WebGPU prepare posts it as is (`webgpu/pages/prepare/cones.ts`, #272). Before, that prepare built
// each cone itself with `triangleCone` from the host vertices, so the cooked cone must hold the one
// it built: a narrower cone would cull a cluster the camera sees. This test rebuilds, on every
// compiled scene of the repository, the cone the runtime would have built — the host positions of
// `source.gltf` as the prepared scene views them, the index page as it is stored — and requires the
// same axis, bit for bit, and an angle no smaller, raised by no more than the compiler's margin
// allows (`ANGLE_MARGIN_ULPS`: `Math.acos` follows the machine, so the angle is rounded up).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCacheManifest } from '../../bench/runner/cacheManifest.ts';
import { triangleCone } from '../kit/cone.ts';
import { preparedGeometries } from '../../packages/sdk-browser/src/host/prepared/geometry.ts';
import { sceneDocument } from '../../packages/sdk-browser/src/scene/tables.ts';
import type { PreparedSceneTables } from '../../packages/sdk-core/src/scene/core/tableContracts.ts';
import { sceneCacheFiles } from '../kit/scenes/caches.ts';

const root = new URL('../../', import.meta.url);

/** The float64 words of `values`: bit for bit, and ulps apart for two numbers of one sign. */
const words = (values: number[]) =>
  Array.from(new BigUint64Array(Float64Array.from(values).buffer));
/** Ulps an angle may stand above the runtime's: the compiler's margin, and as much again for the
 *  two roundings it covers (`normal_cone.rs`, `ANGLE_MARGIN_ULPS`). */
const WIDEST =
  2n *
  BigInt(
    /ANGLE_MARGIN_ULPS: usize = (\d+);/.exec(
      readFileSync(new URL('packages/asset-compiler-rust/src/normal_cone.rs', root), 'utf8'),
    )![1],
  );

/** The bytes of `file` as an `ArrayBuffer`, the one `readFileSync` filled when it holds only them. */
function bytesOf(file: string): ArrayBuffer {
  const bytes = readFileSync(file);
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Every page of the scene cache whose pointer is `pointer`, and how many of them disagree. */
function checkScene(pointer: string) {
  const { dir, manifest } = readCacheManifest(dirname(new URL(pointer, root).pathname));
  const tables = JSON.parse(
    readFileSync(join(dir, 'scene-tables.json'), 'utf8'),
  ) as PreparedSceneTables;
  // The document the WebGPU session draws: `source.gltf`, never the autonomous scene.
  const { document, bufferUrl } = sceneDocument(
    tables,
    'source.gltf',
    pathToFileURL(`${dir}/`).href,
  );
  const geometryOf = preparedGeometries(
    document,
    bufferUrl ? bytesOf(new URL(bufferUrl).pathname) : null,
  );
  // A streaming bundle holds dozens of index pages: each is read once, and a page viewed in it.
  const bundles = new Map<string, ArrayBuffer>();
  const bundle = (url: string) =>
    bundles.get(url) ?? bundles.set(url, bytesOf(join(dir, url))).get(url)!;
  const disagreements: string[] = [];
  let pages = 0;
  for (const primitive of manifest.primitives) {
    if (!primitive.pages.length) continue;
    const position = geometryOf(primitive.mesh, primitive.primitive).attributes.position;
    // The copy the prepare made before it read cones from the cache: every accessor, element by element.
    const xyz = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      xyz[i * 3] = position.getX(i);
      xyz[i * 3 + 1] = position.getY(i);
      xyz[i * 3 + 2] = position.getZ(i);
    }
    for (const page of primitive.pages) {
      pages++;
      const held = page.stream === undefined ? undefined : primitive.streams?.pages[page.stream];
      const indices = held
        ? new Uint32Array(bundle(held.url), page.streamOffset, page.count)
        : new Uint32Array(bundle(page.url), 0, page.count);
      // A version-9 sidecar gives every page its cone.
      const built = triangleCone(xyz, indices),
        cone = page.cone!;
      const cooked = words([...cone.axis, cone.angle]),
        expected = words([...built.axis, built.angle]);
      const wider = cooked[3] - expected[3];
      if (cooked.slice(0, 3).join() !== expected.slice(0, 3).join() || wider < 0n || wider > WIDEST)
        disagreements.push(`${pointer} page ${page.id}: cooked ${JSON.stringify(page.cone)}`);
    }
  }
  return { pages, disagreements };
}

test('every cooked cone holds the cone the runtime built from the same triangles, on its axis', async () => {
  const pointers = await sceneCacheFiles('manifest.json');
  assert.ok(pointers.length > 0, 'the repository compiles its scenes before the unit suite');
  let pages = 0;
  const disagreements: string[] = [];
  for (const pointer of pointers) {
    const scene = checkScene(pointer);
    pages += scene.pages;
    disagreements.push(...scene.disagreements);
  }
  assert.ok(pages > 0, 'the compiled scenes hold clusters');
  assert.deepEqual(disagreements.slice(0, 5), [], `${disagreements.length} of ${pages} pages`);
});
