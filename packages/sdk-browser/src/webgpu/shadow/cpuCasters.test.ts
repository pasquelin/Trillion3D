// Under the CPU cut the casters are selected from the light as well: the same face, read as a
// camera by the CPU cut, keeps what the GPU light cut keeps — the same clusters, at the same
// texel error, over the same redrawn pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCpuCasters } from './cpuCasterRows.ts';
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

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
    runs: 1,
    source: device.createBuffer({ size: 4, usage: 0 }),
    indirect: device.createBuffer({ size: 16, usage: 0 }),
    ...{ bases: list(1), lengths: list(1), commands: list(4), words: list(1) },
    ...{ marks: list(3), rowOf: new Int32Array(3), shown: [pages], shownPacked: [[0, 1, 2]] },
  };
  const rt = {
    lights: { cpuCasters, plannedFrame: 9 },
    run: { frame: 9 },
    layout: { rows },
  } as unknown as WebgpuPagesRuntime;
  writeCpuCasters(rt, device);
  const source = writes.find((w) => w.buffer === cpuCasters.source)!;
  assert.deepEqual(Array.from(written(source)), [0, 5], 'the opaque row, then the caster row');
  assert.equal(cpuCasters.commands[1], 2);
});
