// #1363, #831: the GPU pages' pairs land in the region cull's kept list, grown once to the pool's
// fixed pairs (`poolPairs`) by the tables' own growth (`growKeptList`), under the shadow grant: past
// the grant or the device, a pressure by name and the list as it was; never past one storage binding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/recordPack.ts';
import { growKeptList, keptList } from '../../gpu/shadow/keptList.ts';
import { shadowTransmittanceBytes } from '../../gpu/shadow/transmittance.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/shadowBudgetBytes.ts';
import { createShadowMemory, shadowPoolHeld } from './memoryGrant.ts';
import { growPairList } from './pairGrowth.ts';
import { keptPairs, PAIRS_PER_PAGE, poolPairs } from './pairRows.ts';
import { SHADOW_GPU_PAGES_PER_FRAME } from '../../gpu/shadow/batchBudget.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

const ROW_BYTES = 4 * MAX_SHADOW_REGIONS;

/** A runtime of `casterSlots` table rows and a pool of `pages` pages, its kept list at the table's
 *  rows, and the diagnostics it says. */
function runtime(
  device: GPUDevice,
  pages: number,
  casterSlots = 8,
  heldBytes = 0,
  transmittanceDenied = true,
) {
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
      pageRequests: { bytes: heldBytes, allocation: {} },
      plan: { pool: { side: 8, layers: 1, pages } },
      transmittanceDenied,
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

test("the kept list grows once to the pool's pairs, counted in the shadow grant, never past", async () => {
  const fake = fakeDevice(),
    { rt, grow } = runtime(fake.device, 2);
  const rows = await grow();
  assert.ok(keptPairs(rows) >= poolPairs(2), "the list holds the pool's pairs");
  assert.ok(poolPairs(2) > keptPairs(8), "past the table's rows");
  assert.equal(
    rt.lights.memory.pairBytes,
    (rows - 8) * ROW_BYTES,
    'its rows past the table in the grant',
  );
  assert.equal(shadowPoolHeld(rt.lights), rt.lights.memory.pairBytes);
  const asked = fake.buffers.length,
    held = shadowPoolHeld(rt.lights);
  // Asked again, whatever the frames count, it asks nothing: the bytes shown are the ones set.
  assert.equal(await grow(), rows);
  assert.equal(fake.buffers.length, asked);
  assert.equal(shadowPoolHeld(rt.lights), held);
});

test('a list the device refuses names a pressure and is not asked again', async () => {
  const fake = fakeDevice({ refuse: (d) => (Number(d.size) > 8 * ROW_BYTES ? 'oom' : undefined) }),
    { rt, said, grow } = runtime(fake.device, 4);
  assert.equal(await grow(), 8, 'the list stays as it was');
  assert.deepEqual(rt.lights.memory.events, ['pairs-refused']);
  assert.deepEqual(said, ['gpu-out-of-memory']);
  const asked = fake.buffers.length;
  assert.equal(await grow(), 8);
  assert.equal(fake.buffers.length, asked, 'a refused growth is not asked again');
});

test('a list past the shadow grant is not asked of the device', async () => {
  const fake = fakeDevice(),
    { rt, said, grow } = runtime(fake.device, 4, 8, SHADOW_GRANT_BYTES);
  const asked = fake.buffers.length;
  assert.equal(await grow(), 8);
  assert.equal(fake.buffers.length, asked);
  assert.deepEqual(rt.lights.memory.events, ['pairs-over-grant']);
  await grow();
  assert.deepEqual(said, ['shadow-memory'], 'said once');
});

test('a list leaves the transmittance layer still to come its share of the grant', async () => {
  const fake = fakeDevice(),
    held = SHADOW_GRANT_BYTES - shadowTransmittanceBytes(8, 1),
    { rt, grow } = runtime(fake.device, 4, 8, held, false);
  assert.equal(await grow(), 8, 'the list stays as it was');
  assert.deepEqual(rt.lights.memory.events, ['pairs-over-grant']);
});

test('the kept list never grows past what one storage binding holds', async () => {
  // A binding of 20 rows and a half a region: a list past it would be invalid, not refused.
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 20.5 * ROW_BYTES } as never }),
    { grow } = runtime(fake.device, 40);
  assert.equal(await grow(), 20, 'the ceiling, in whole rows');
  const asked = fake.buffers.length;
  assert.equal(await grow(), 20);
  assert.equal(fake.buffers.length, asked, 'the ceiling reached, nothing more is asked');
});

test("the pair list holds a frame's pairs, not the whole pool's (#831)", () => {
  // The GPU maps a frame's page budget at most: a list of the pool's every pair took 10.6 MB.
  assert.equal(poolPairs(2601), SHADOW_GPU_PAGES_PER_FRAME * PAIRS_PER_PAGE);
  assert.equal(poolPairs(64), 64 * PAIRS_PER_PAGE, 'a pool smaller than the budget, its own');
});
