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
import { faceEngineCamera, writeCpuCasters } from './cpuCasters.ts';
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

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

// #35: under the CPU cut, a face that keeps a blended cluster lists it at its caster row, behind
// the visibility rows; a page that holds neither is left out.
test('the CPU cut lists a blended caster at its shadow-only row', () => {
  const { device, writes } = fakeDevice();
  const pages = [0, 1, 2].map((id) => ({ id }) as unknown as PageRec);
  const rows = {
    packedCount: 1,
    packedPageIndex: Int32Array.of(0),
    blendRowOf: Int32Array.of(-1, 5, -1),
    pageIndexOf: (rec: PageRec) => rec.id as number,
  };
  const list = (n: number) => new Uint32Array(n);
  const cpuCasters = {
    frame: -1,
    source: device.createBuffer({ size: 4, usage: 0 }),
    indirect: device.createBuffer({ size: 16, usage: 0 }),
    ...{ bases: list(1), lengths: list(1), commands: list(4), words: list(1) },
    ...{ marks: list(3), rowOf: new Int32Array(3), shown: [pages] },
  };
  const rt = {
    lights: { runs: { count: 1 }, cpuCasters, plannedFrame: 9 },
    run: { frame: 9 },
    layout: { rows },
  } as unknown as WebgpuPagesRuntime;
  writeCpuCasters(rt, device);
  const source = writes.find((w) => w.buffer === cpuCasters.source)!;
  assert.deepEqual(Array.from(written(source)), [0, 5], 'the opaque row, then the caster row');
  assert.equal(cpuCasters.commands[1], 2);
});
