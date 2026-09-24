// Under the CPU cut the casters are selected from the light as well: the same face, read as a
// camera by the CPU cut, keeps what the GPU light cut keeps — the same clusters, at the same
// texel error, over the same redrawn pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineCamera } from '../../camera/world.ts';
import { selectVisiblePages } from '../../page/selection/selection.ts';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { evaluateDagSelectionKernel, packedWorldsToRenderOrigin } from '../../gpu/dag/selection.ts';
import { packed } from '../../gpu/dag/selectionHelpers.fixture.ts';
import { sunRun } from './runs.fixture.ts';
import { faceEngineCamera } from './cpuCasters.ts';

for (const [side, pages] of [
  [1024, [0, 7, 0, 7]],
  [256, [0, 7, 0, 7]],
  [32, [0, 7, 0, 7]],
  [1024, [0, 0, 0, 0]],
] as const) {
  test(`the CPU cut keeps what the GPU light cut keeps: ${side} texels, pages ${pages.join(',')}`, () => {
    const { dag, roots } = packed(dagFixture());
    packedWorldsToRenderOrigin(dag, roots, [0, 0, 0]);
    const run = sunRun(side, [0, 0, 0], [...pages]);
    const gpu = evaluateDagSelectionKernel(dag, run.uniforms)
      .pageIds.map((id) => dag.pageUrls[id])
      .sort();
    const viewport = [1, 1] as [number, number];
    const camera = faceEngineCamera(run, createEngineCamera(), viewport);
    const cpu = selectVisiblePages(roots, camera, {
      pixelError: 1,
      viewport,
      light: run.pages,
    })
      .wanted.map((page) => page.url)
      .sort();
    assert.deepEqual(cpu, gpu);
  });
}
