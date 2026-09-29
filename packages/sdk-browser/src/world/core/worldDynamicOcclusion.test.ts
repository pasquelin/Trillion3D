// #573: a dynamic geometry is drawn by the paged clusters' own visibility and Hi-Z: occluded behind
// an opaque wall, and — bounded by the box its vertices never leave — never culled in front.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveObjectURL } from 'node:buffer';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { collectClusterPages, type PageRec } from '../../page/selection/selection.ts';
import { rasterVisibilityIds } from '../../visibility/buffer.ts';
import { buildHizPyramid, filterUnoccluded, visibilityDepth } from '../../hiz/hiz.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { cameraAt } from '../../../../../tests/fixtures/hiz.ts';
import type { ExplorerSource } from '../session/prepare.ts';
import { dynamicWorld } from './worldDynamic.fixture.ts';

const SIZE: [number, number] = [64, 64];

/** The records a session opened on `source` collects, each holding the corners of its page. */
async function recordsOf(source: ExplorerSource) {
  const { scene, metadata } = source;
  const { allPages } = collectClusterPages(scene.source, metadata, new Map(), scene.associations, {
    allowMissing: true,
  });
  for (const rec of allPages)
    rec.array = new Uint32Array(await resolveObjectURL(rec.url)!.arrayBuffer());
  return allPages as (PageRec & { array: Uint32Array })[];
}

/** The dynamic records of the view from z = 5 that the Hi-Z test keeps, and all of them. */
function keptOf(records: Awaited<ReturnType<typeof recordsOf>>) {
  const camera = cameraMoteur(cameraAt(5)),
    ids = rasterVisibilityIds(records, camera, SIZE);
  const pyramid = buildHizPyramid(visibilityDepth(ids, records, camera, SIZE), ...SIZE);
  const dynamic = records.filter((rec) => !rec.geometryPage);
  return { dynamic, kept: filterUnoccluded(dynamic, pyramid, camera, SIZE) };
}

/** A wall at z = 0 and a dynamic sheet at `z`, drawn once. The wall's centre is off the view's:
 *  the diagonal its two triangles share, where the reference raster leaves seam pixels, runs out
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
  return { world, sheet, records: await recordsOf(world.sources[0]) };
}

test('a dynamic sheet behind an opaque wall is occluded by the Hi-Z test the pages pass', async () => {
  const { world, records } = await wallAndSheet(-2);
  const { dynamic, kept } = keptOf(records);
  world.end();
  assert.ok(
    dynamic.length > 0,
    'the sheet is paged by its index alone, its vertices read as floats',
  );
  assert.equal(kept.length, 0, 'every cluster of it hidden');
});

test('a dynamic sheet in front is never culled, its rewritten vertices within the box that culls it', async () => {
  const { world, sheet, records } = await wallAndSheet(2);
  const position = sheet.attributes.position;
  for (let frame = 0; frame < 30; frame++) {
    for (let v = 0; v < position.count; v++) position.setZ(v, Math.sin(frame + v) * 0.3);
    position.needsUpdate = true;
    await world.frame();
    const { dynamic, kept } = keptOf(records);
    assert.equal(kept.length, dynamic.length, `frame ${frame}: every cluster kept`);
    for (const rec of dynamic) {
      const drawn = rec.attributes.position.array as Float32Array;
      assert.equal(drawn[2], Math.fround(position.getZ(0)), 'the pages read the written vertices');
      for (let i = 0; i < drawn.length; i++)
        assert.ok(drawn[i] >= rec.min[i % 3] && drawn[i] <= rec.max[i % 3], `frame ${frame}`);
    }
  }
  world.end();
  assert.equal(world.sources.length, 1);
});
