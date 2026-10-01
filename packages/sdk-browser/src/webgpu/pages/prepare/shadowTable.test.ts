// #1345: the GPU page table is allocated up front at the session's whole table, as develop and as
// Unreal allocate theirs — only the physical page pool is budgeted —, so a shadow-casting light
// added at any time finds its span held: its shadow is in its first presented frame.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LAMP,
  SUN,
  VIEW,
} from '../../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { fakeDevice, type FakeWrite } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import { SHADOW_TABLE_OFFSET } from '../../../gpu/shadow/atlas.ts';
import { createWebgpuLightState } from '../state/lights.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { prepareDirectLights } from './lights.ts';

test('a shadow-casting light added after prepare has its shadow in its first frame', async () => {
  const { device, writes } = fakeDevice(),
    lights = createWebgpuLightState(16),
    { table } = lights.plan;
  lights.buffer = {} as GPUBuffer;
  const rt = {
    lights,
    context: {},
    vis: { visEnabled: true, visBindGroupLayout: {} },
    blendState: { blendGpu: [] },
    layout: { rows: { casterSlots: 64 } },
    capabilities: { unsupported: [] },
    diag: {
      engineDiagnostic() {},
      diagnosticFailure: (_: string, error: unknown) => assert.fail(String(error)),
    },
    signal: new AbortController().signal,
  } as unknown as WebgpuPagesRuntime;
  await prepareDirectLights(rt, device);
  const atlas = lights.shadows!;
  assert.equal(atlas.dataBuffer.size, SHADOW_TABLE_OFFSET + table.entries * 4, 'the whole table');
  const frame = (at: number) =>
    lights.plan.plan(lights.store, VIEW, [-10, 0, -10], [10, 5, 10], at, 0);
  lights.store.add(SUN);
  frame(0);
  lights.store.add(LAMP);
  frame(1);
  assert.equal(lights.plan.counts.unslicedCasters, 0, 'no light waits unshadowed');
  const lamp = table.baseOf(lights.store.sliceOf(1));
  assert.ok(lamp >= 0, 'the lamp holds its span in the frame it is added');
  writes.length = 0;
  atlas.flushData(table);
  const at = SHADOW_TABLE_OFFSET + lamp * 4;
  // A write's size counts the table's 32-bit words.
  const reaches = (w: FakeWrite) => w.offset <= at && w.offset + (w.size ?? 0) * 4 > at;
  assert.ok(
    writes.some((w) => w.buffer === atlas.dataBuffer && reaches(w)),
    "its words reach the GPU's table",
  );
});
