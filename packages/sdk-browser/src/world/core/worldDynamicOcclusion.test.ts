// #573: a dynamic geometry is drawn by the paged clusters' own visibility and Hi-Z: occluded behind
// an opaque wall, and — each page bounded by its corners grown by the reach — never culled in front.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveObjectURL } from 'node:buffer';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { collectClusterPages, type PageRec } from '../../page/selection/selection.ts';
import { postPackedBases, type PageLocations } from '../../page/selection/placements.ts';
import { buildHizPyramid } from '../../hiz/depth.ts';
import { filterUnoccluded } from '../../hiz/unoccluded.ts';
import { visibilityDepth } from '../../hiz/visibilityDepth.fixture.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { cameraAt } from '../../../../../tests/fixtures/hiz.ts';
import type { ExplorerSource } from '../session/prepare.ts';
import { dynamicWorld } from './worldDynamic.fixture.ts';
import { rasterVisibilityIds } from '../../../../../bench/oracles/browser/cpu-image/raster.ts';

const SIZE: [number, number] = [64, 64];

/** The records a session opened on `source` collects, each holding the corners of its page, and
 *  the roots whose rank each posts. */
async function recordsOf(source: ExplorerSource) {
  const { scene, metadata } = source;
  const { allPages, roots } = collectClusterPages(
    scene.source,
    metadata,
    new Map(),
    scene.associations,
    { allowMissing: true },
  );
  for (const rec of allPages)
    rec.array = new Uint32Array(await resolveObjectURL(rec.url)!.arrayBuffer());
  // Each record's placement, by its first packed rank (#1235): one record may serve several.
  const placement = postPackedBases(roots),
    first = new Map<PageRec, number>();
  for (let r = 0; r < roots.length; r++)
    for (let p = 0; p < roots[r].pages.length; p++)
      if (!first.has(roots[r].pages[p])) first.set(roots[r].pages[p], placement.baseOfRoot[r] + p);
  const packedOf = (rec: PageRec) => first.get(rec) ?? 0,
    locationOf = (pages: readonly PageRec[]): PageLocations => ({
      roots,
      packed: pages.map(packedOf),
      rootOfPacked: placement.rootOfPacked,
    });
  const records = allPages as (PageRec & { array: Uint32Array })[];
  return { records, locations: locationOf(records), locationOf };
}

/** The dynamic records of the view from z = 5 that the Hi-Z test keeps, and all of them. */
function keptOf({ records, locations, locationOf }: Awaited<ReturnType<typeof recordsOf>>) {
  const camera = readCameraWorld(createEngineCamera(), cameraAt(5)),
    ids = rasterVisibilityIds(records, locations, camera, SIZE);
  const pyramid = buildHizPyramid(visibilityDepth(ids, records, locations, camera, SIZE), ...SIZE);
  const dynamic = records.filter((rec) => !rec.geometryPage);
  // `locations` must be parallel to the list read: the dynamic subset gets its own (#1235).
  return { dynamic, kept: filterUnoccluded(dynamic, locationOf(dynamic), pyramid, camera, SIZE) };
}

/** A wall at z = 0 and a dynamic sheet at `z`, drawn once. The wall's centre is off the view's:
 *  the diagonal its two triangles share, where a raster leaves seam pixels, runs out
 *  of sight. */
async function wallAndSheet(z: number) {
  const world = dynamicWorld();
  const stone = material.meshStandard({}),
    wall = object.mesh(geometry.box(30, 30, 0.2), stone);
  wall.position.x = 10;
  world.scene.add(wall);
  const sheet = geometry.plane(1, 1, 8, 8);
  sheet.usage = 'dynamic';
  const mesh = object.mesh(sheet, stone);
  mesh.position.z = z;
  world.scene.add(mesh);
  await world.frame();
  return { world, sheet, collected: await recordsOf(world.sources[0]) };
}

test('a dynamic sheet behind an opaque wall is occluded by the Hi-Z test the pages pass', async () => {
  const { world, collected } = await wallAndSheet(-2);
  const { dynamic, kept } = keptOf(collected);
  world.end();
  assert.ok(dynamic.length > 0, 'paged by its index alone, its vertices read as floats');
  assert.equal(kept.length, 0, 'every cluster of it hidden');
});

test('a dynamic sheet in front is never culled, its rewritten corners within their page box grown by the reach', async () => {
  const { world, sheet, collected } = await wallAndSheet(2);
  const position = sheet.attributes.position;
  for (let frame = 0; frame < 30; frame++) {
    for (let v = 0; v < position.count; v++) position.setZ(v, Math.sin(frame + v) * 0.3);
    position.needsUpdate = true;
    await world.frame();
    const { dynamic, kept } = keptOf(collected);
    assert.equal(kept.length, dynamic.length, `frame ${frame}: every cluster kept`);
    const reach = world.reaches.at(-1)!;
    for (const rec of dynamic) {
      const drawn = rec.attributes.position.array as Float32Array;
      assert.equal(drawn[2], Math.fround(position.getZ(0)), 'the pages read the written vertices');
      for (const v of rec.array)
        for (let a = 0; a < 3; a++) {
          const at = drawn[v * 3 + a];
          assert.ok(at >= rec.min[a] - reach && at <= rec.max[a] + reach, `frame ${frame}`);
        }
    }
  }
  world.end();
  assert.equal(world.sources.length, 1);
});
