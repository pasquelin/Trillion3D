/**
 * Generates the open world of #332 and compiles it into one cache, under
 * `site/assets/examples/openworld/` (ignored by git, rebuilt on demand): `source/` (glTF),
 * `cache/`, `heights/` and `colliders/` for the physics, `world.json` and `vehicles.json` for
 * the page. `--source-only` skips the compiler. Same seed, same bytes.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { buildWorld } from './docs/examples/openworld/build/world.ts';
import { tileColliders } from './docs/examples/openworld/build/colliders.ts';
import {
  collisionMeshPath,
  encodeCollisionMesh,
} from '../site/examples/kit/openworld/play/collision.ts';
import { writeWorldGltf } from './docs/examples/openworld/gltf/write.ts';
import { writeHeights } from './docs/examples/openworld/plan/heights.ts';
import { VEHICLE_SPECS } from './docs/examples/openworld/props/vehicles.ts';

const root = resolve(import.meta.dirname, '..'),
  out = resolve(root, 'site/assets/examples/openworld'),
  compiler =
    process.env.WG_COMPILER ??
    resolve(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');

const started = performance.now(),
  lap = (label: string) =>
    console.log(`${label}: ${((performance.now() - started) / 1000).toFixed(1)} s`);

await rm(out, { recursive: true, force: true });
const { plan, terrain, objects, solids, data } = buildWorld();
lap('world built');
const source = resolve(out, 'source');
// One glTF: the compiler reads exactly one per source folder.
const written = await writeWorldGltf(source, 'world', {
  meshes: [...terrain.meshes, ...objects.meshes],
  instances: [...terrain.instances, ...objects.instances],
  lights: objects.lights,
  images: terrain.textures,
});
lap('sources written');
await writeHeights(out, plan, data.heightSamples);
const colliders = tileColliders(solids.placed, data.size, data.tile);
await mkdir(resolve(out, 'colliders'), { recursive: true });
let [triangles, bytes] = [0, 0];
for (const [id, mesh] of solids.shapes) {
  const file = resolve(out, 'colliders', collisionMeshPath(id)),
    encoded = encodeCollisionMesh(mesh);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, encoded);
  triangles += mesh.indices.length / 3;
  bytes += encoded.byteLength;
}
console.log(
  `collision meshes: ${solids.shapes.size} props, ${triangles} triangles, ${bytes} bytes`,
);
// Every tile gets its file, empty or not: the physics worker asks for each one it streams.
const tiles = data.size / data.tile;
for (let tx = 0; tx < tiles; tx++)
  for (let tz = 0; tz < tiles; tz++) {
    const key = `${tx}_${tz}`;
    await writeFile(
      resolve(out, 'colliders', `${key}.json`),
      JSON.stringify(colliders.get(key) ?? []),
    );
  }
await writeFile(resolve(out, 'world.json'), JSON.stringify(data));
await writeFile(resolve(out, 'vehicles.json'), JSON.stringify(VEHICLE_SPECS));
lap('physics and page data written');
const { stats } = terrain;
console.log(
  `${written.gltf}: ${written.triangles} triangles, ${written.nodes} nodes, ${written.bytes} bytes`,
  `\nterrain: ${stats.triangles} triangles, threshold ${stats.threshold.toFixed(3)} m, land edge`,
  `mean ${stats.landEdge.mean.toFixed(1)} m, max ${stats.landEdge.max.toFixed(1)} m;`,
  `${stats.textureSize}² texels a tile (${stats.texelsPerMetre.toFixed(3)} per metre),`,
  `${stats.textureBytes} bytes of textures at most`,
);

if (!process.argv.includes('--source-only')) {
  // Relative paths: a cache that names this machine's folders is refused by the repository.
  const threads = String(Math.min(64, availableParallelism())),
    ram = String(Math.floor(totalmem() / 2 ** 21)),
    result = spawnSync(
      compiler,
      ['source', 'cache', 'full', '150000', threads, ram, '../../../../source/', 'qem-endpoints'],
      { cwd: out, stdio: ['ignore', 'ignore', 'inherit'] },
    );
  if (result.status !== 0) throw new Error(`compiler failed with status ${result.status}`);
  await rm(resolve(out, 'cache/native/.lock'), { recursive: true, force: true });
  lap(`compiled on ${threads} threads`);
}
