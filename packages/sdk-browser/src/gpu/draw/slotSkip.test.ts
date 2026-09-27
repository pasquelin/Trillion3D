import test from 'node:test';
import assert from 'node:assert/strict';
import { drawShader } from './shader.ts';

// Indirect compact receives, per slot, the row count the GPU partition wrote there
// (`classifyRows`, ../partition/classifyWgsl.ts). A slot that count says is empty has no reason
// to be scanned by the shader: `slotUsed` carries that fact. The counting pass reads each item
// once and writes such a slot a zero count; the prefix pass returns before scanning it.

test('drawShader(k) writes an empty slot a zero count and guards the prefix pass by slotUsed', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k);

    // countGroups has no per-slot scan to skip (groupCompaction.test.ts pins its shape): an empty
    // slot is only written zero.
    assert.ok(
      shader.includes('select(atomicLoad(&slotTally[slot]),0u,slotUsed[slot]==0u)'),
      'an empty slot still reports zero',
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
