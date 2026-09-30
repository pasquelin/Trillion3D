// #1363: the GPU pages' pairs land in the region cull's kept list, grown to the need the frames
// read back by the tables' own growth (`growKeptList`), under the shadow grant: past the grant or
// the device, a pressure by name and the list as it was; never past one storage binding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/recordPack.ts';
import { growKeptList, keptList } from '../../gpu/shadow/keptList.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';
import { createShadowMemory, shadowPoolHeld } from './memoryGrant.ts';
import { growPairList, keptPairs } from './pairGrowth.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

const ROW_BYTES = 4 * MAX_SHADOW_REGIONS;

/** A runtime of `casterSlots` table rows whose latest frame counted `need` pairs, its kept list at
 *  the table's rows, and the diagnostics it says. */
function runtime(device: GPUDevice, need: number, casterSlots = 8, heldBytes = 0) {
  const targets = { kept: keptList(device, casterSlots), capacity: casterSlots },
    offsets = device.createBuffer({ size: (MAX_SHADOW_REGIONS + 1) * 4, usage: 0 });
  const cull = {
    get kept() {
      return targets.kept;
    },
    get capacity() {
      return targets.capacity;
    },
    grow: (rows: number) => growKeptList(device, targets, offsets, rows, () => {}),
  };
  const said: string[] = [];
  const rt = {
    lights: {
      cull,
      memory: createShadowMemory(),
      pageRequests: { bytes: heldBytes, allocation: { pairNeed: need } },
    },
    layout: { rows: { casterSlots }, growing: undefined as Promise<unknown> | undefined },
    gpu: { device },
    diag: { engineDiagnostic: (code: string) => void said.push(code) },
    run: { lost: false, gate: { resourcesChanged() {} } },
    setup: { preparing: undefined },
    signal: new AbortController().signal,
  } as unknown as WebgpuPagesRuntime;
  const grow = async () => {
    growPairList(rt);
    await rt.layout.growing;
    return rt.lights.cull!.capacity;
  };
  return { rt, said, grow };
}

test('the kept list grows to the pairs the frames read back, counted in the shadow grant', async () => {
  const fake = fakeDevice(),
    need = 3 * keptPairs(8) + 1,
    { rt, grow } = runtime(fake.device, need);
  const rows = await grow();
  assert.ok(keptPairs(rows) >= need, 'the list holds the need');
  assert.equal(
    rt.lights.memory.pairBytes,
    (rows - 8) * ROW_BYTES,
    'its rows past the table in the grant',
  );
  assert.equal(shadowPoolHeld(rt.lights), rt.lights.memory.pairBytes);
  const asked = fake.buffers.length;
  assert.equal(await grow(), rows, 'a need it holds asks nothing more');
  assert.equal(fake.buffers.length, asked);
});

test('a list the device refuses names a pressure and is not asked again', async () => {
  const fake = fakeDevice({ refuse: (d) => (Number(d.size) > 8 * ROW_BYTES ? 'oom' : undefined) }),
    { rt, said, grow } = runtime(fake.device, 10 * keptPairs(8));
  assert.equal(await grow(), 8, 'the list stays as it was');
  assert.deepEqual(rt.lights.memory.events, ['pairs-refused']);
  assert.deepEqual(said, ['gpu-out-of-memory']);
  const asked = fake.buffers.length;
  assert.equal(await grow(), 8);
  assert.equal(fake.buffers.length, asked, 'a refused growth is not asked again');
});

test('a list past the shadow grant is not asked of the device', async () => {
  const fake = fakeDevice(),
    { rt, said, grow } = runtime(fake.device, 10 * keptPairs(8), 8, SHADOW_GRANT_BYTES);
  const asked = fake.buffers.length;
  assert.equal(await grow(), 8);
  assert.equal(fake.buffers.length, asked);
  assert.deepEqual(rt.lights.memory.events, ['pairs-over-grant']);
  await grow();
  assert.deepEqual(said, ['shadow-memory'], 'said once');
});

test('the kept list never grows past what one storage binding holds', async () => {
  // A binding of 20 rows and a half a region: a list past it would be invalid, not refused.
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 20.5 * ROW_BYTES } as never }),
    { grow } = runtime(fake.device, 100 * keptPairs(8));
  assert.equal(await grow(), 20, 'the ceiling, in whole rows');
  const asked = fake.buffers.length;
  assert.equal(await grow(), 20);
  assert.equal(fake.buffers.length, asked, 'the ceiling reached, nothing more is asked');
});
