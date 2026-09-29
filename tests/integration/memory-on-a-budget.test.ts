// `memory-on-a-budget` at its smallest budgets, 64 KiB and one byte (#1237, the #484 follow-up):
// the example's view of `signature-architecture`, and the same view turned 90°, 180° and 270°
// around its target. The measurer found the root cover drawn there whatever its error — lost
// columns and lintels, arches turned to blobs. Here the WebGL2 pool and image cut (`imageCut.ts`,
// `pool.ts`) run on the compiled DAG of every primitive, at the host's threshold (0 px): once the
// pool settles, no root whose error the view refuses is drawn — its group's pages stand in, where
// the cook kept the parts the root drops — and no surface is left without a drawn cluster.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readCacheManifest } from '../../bench/runner/cacheManifest.ts';
import { Camera } from '../../packages/sdk-core/src/world/camera/camera.ts';
import { Box3 } from '../../packages/sdk-core/src/world/math/box3.ts';
import { Vector3, readVec3 } from '../../packages/sdk-core/src/world/math/vector3.ts';
import { structureIndex } from '../../packages/sdk-browser/src/page/selection/structure.ts';
import { pose } from '../../packages/sdk-browser/src/world/pose/index.ts';
import { mount } from '../../packages/sdk-browser/src/backend/autonomous/poolCut.fixture.ts';
import type { HostCamera } from '../../packages/sdk-browser/src/camera/world.ts';
import type { DagPage } from '../../bench/perf/browser/support/dagCut.ts';

const FULL = new URL(
  '../../site/assets/gallery/signature-architecture/cache/native/full',
  import.meta.url,
);

/** Every primitive's pages, as the WebGL2 pool reads them, their group links and decoded bytes. */
async function court() {
  const { manifest } = await readCacheManifest(FULL.pathname);
  const bytes = new Map<string, number>(),
    bounds = new Box3();
  const primitives = manifest.primitives.map((primitive) =>
    primitive.pages.map((page) => {
      const url = `${primitive.primitive}/${page.url}`;
      bytes.set(url, page.geometry!.uncompressedBytes);
      bounds.expandByPoint(new Vector3(...page.min)).expandByPoint(new Vector3(...page.max));
      return { ...page, url, triangles: page.count / 3, array: undefined } as unknown as DagPage;
    }),
  );
  const structures = manifest.primitives.map((primitive, at) =>
    structureIndex(primitive.structure, primitives[at].length),
  );
  return { primitives, structures, bytes, bounds };
}

/** The example's camera (`site/examples/memory-on-a-budget.html`): the court framed, then 40 % of
 *  the way to its target, turned `quarter` quarters around it. */
function view(bounds: Box3, quarter: number) {
  const framing = pose.fromBounds(bounds),
    target = readVec3(framing.target!);
  const [x, y, z] = readVec3(framing.position!).map((value, axis) => 0.6 * (value - target[axis]));
  const [cos, sin] = [
    Math.round(Math.cos((quarter * Math.PI) / 2)),
    Math.round(Math.sin((quarter * Math.PI) / 2)),
  ];
  const camera = new Camera('perspective');
  camera.position.set(target[0] + x * cos + z * sin, target[1] + y, target[2] - x * sin + z * cos);
  camera.lookAt(new Vector3(...target));
  camera.updateMatrixWorld();
  return camera as unknown as HostCamera;
}

for (const budget of [64 * 1024, 1])
  test(`at ${budget} bytes, four azimuths: no root the view refuses is drawn, and no hole`, async () => {
    const { primitives, structures, bytes, bounds } = await court();
    for (let quarter = 0; quarter < 4; quarter++) {
      const run = mount(budget, {
        pages: primitives.flat(),
        primitives,
        structures,
        bytes: (url) => bytes.get(url)!,
        camera: view(bounds, quarter),
      });
      for (let image = 0; image < 32; image++) run.image(0);
      const { shown, wanted, uncoveredTriangles } = run.cut();
      const refused = shown.filter((page) => page.parentError == null && !wanted.includes(page));
      assert.deepEqual(
        refused.map((page) => page.url),
        [],
        `quarter ${quarter}: refused roots drawn`,
      );
      assert.equal(uncoveredTriangles, 0, `quarter ${quarter}: a surface without a drawn cluster`);
      assert.ok(shown.length > 0, `quarter ${quarter}: the court is drawn`);
    }
  });
