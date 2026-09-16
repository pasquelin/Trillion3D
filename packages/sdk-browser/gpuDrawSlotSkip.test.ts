import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals, mockDrawDevice } from '../../test/fixtures/gpuDraw.ts';
import { BASE_SLOTS, BIN_BACK, createGpuDraw } from './gpuDraw.ts';
import { drawShader } from './gpuDrawShader.ts';

// La compaction indirecte reçoit, par slot, le compte que le CPU a déjà fait en construisant les
// items de l'image (`layout.binInstances` dans webgpuPagesEncodeVis.ts / webgpuVisibilityItems.ts).
// Un slot que ce compte dit vide n'a aucune raison d'être parcouru par le shader : `slotUsed` porte
// cette information et la garde de chaque passe s'en sert pour sortir avant de parcourir quoi que ce
// soit pour ce slot.

test('drawShader(k) guards both the counting and the prefix pass by slotUsed before they scan anything for that slot', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k);

    const countGuard = shader.indexOf('if(slotUsed[slot]==0u){groupCounts[entry]=0u;return;}');
    const countScan = shader.indexOf('for(var i=begin;i<end;i++)');
    assert.ok(countGuard >= 0, 'countGroups checks slotUsed for its slot');
    assert.ok(
      countGuard >= 0 && countScan > countGuard,
      'the empty-slot return happens before the per-item scan, not after it',
    );

    const prefixGuard = shader.indexOf('if(slotUsed[slot]==0u){writeCmd(slot,0u);continue;}');
    const prefixScan = shader.indexOf('for(var group=0u;group<uni.groupCount;group++){total=');
    assert.ok(prefixGuard >= 0, 'prefixGroups checks slotUsed for its slot');
    assert.ok(
      prefixGuard >= 0 && prefixScan > prefixGuard,
      'the empty-slot continue happens before the per-group total, not after it',
    );
  }
});

test('gpuDraw.encode writes the CPU per-slot counts as slotUsed, and a slot counted at zero leaves the busy slots’ result unchanged', async () => {
  installGpuGlobals();
  // Two items, both binned back/occluder: every slot but BIN_BACK is empty by construction.
  const items = new Uint32Array([4, BIN_BACK, 0, 0, 7, BIN_BACK, 0, 0]);
  const rest = new Uint32Array(1);
  const slotItems = new Uint32Array(6);
  slotItems[BIN_BACK] = 2;
  // slotCap picked so slotUsed (6 * 4 = 24 bytes) is the only buffer of that size among the eight
  // gpuDrawBuffers allocates: it stays identifiable without depending on their creation order.
  const slotCap = 65;

  const withCounts = mockDrawDevice();
  const gpuWithCounts = await createGpuDraw(withCounts.device, slotCap);
  assert.ok(gpuWithCounts);
  gpuWithCounts.encode(
    withCounts.device.createCommandEncoder(),
    items,
    2,
    0,
    1,
    rest,
    768,
    undefined,
    slotItems,
  );
  const slotUsedBuf = withCounts.buffers.find((buffer) => buffer.size === BASE_SLOTS * 4);
  assert.ok(slotUsedBuf, 'the slotUsed buffer (one u32 per base slot) is allocated');
  assert.deepEqual(
    [...new Uint32Array(slotUsedBuf!.data.buffer)],
    [...slotItems],
    'every slot’s CPU count, including the zeros, reaches the shader as slotUsed',
  );

  // The exact same items, encoded the pre-existing way: no slotItems, every slot compacted.
  const withoutCounts = mockDrawDevice();
  const gpuWithoutCounts = await createGpuDraw(withoutCounts.device, slotCap);
  assert.ok(gpuWithoutCounts);
  assert.equal(
    gpuWithoutCounts.slots,
    BASE_SLOTS,
    'a scene with no coplanar layer keeps six slots',
  );
  gpuWithoutCounts.encode(withoutCounts.device.createCommandEncoder(), items, 2, 0, 1, rest, 768);

  const indirectWith = gpuWithCounts.indirectBuffer as unknown as { data: Uint8Array };
  const indirectWithout = gpuWithoutCounts.indirectBuffer as unknown as { data: Uint8Array };
  assert.deepEqual(
    [...indirectWith.data],
    [...indirectWithout.data],
    'the busy slot compacts to the same drawIndirect command whether or not the empty slots were pre-counted',
  );
  const instancesWith = gpuWithCounts.instanceBuffer as unknown as { data: Uint8Array };
  const instancesWithout = gpuWithoutCounts.instanceBuffer as unknown as { data: Uint8Array };
  assert.deepEqual([...instancesWith.data], [...instancesWithout.data]);

  gpuWithCounts.dispose();
  gpuWithoutCounts.dispose();
});
