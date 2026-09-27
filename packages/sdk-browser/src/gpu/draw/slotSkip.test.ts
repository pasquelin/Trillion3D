import test from 'node:test';
import assert from 'node:assert/strict';
import { drawShader } from './shader.ts';

// Indirect compact receives, per slot, the row count the GPU partition wrote there
// (`classifyRows`, ../partition/classifyWgsl.ts). A slot that count says is empty has no reason
// to be scanned by the shader: `slotUsed` carries that fact, and each pass's guard uses it to
// return before scanning anything for that slot.

test('drawShader(k) reads each item once when counting, and guards the prefix pass by slotUsed', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k);

    // countGroups no longer scans items per slot: each lane reads its own item once, so there is
    // no per-slot scan left to skip — an empty slot is only written zero.
    assert.ok(
      shader.includes('let s=slotAt(group*64u+lane,min(uni.count,uni.slotCap));'),
      'countGroups reads each item once',
    );
    assert.ok(
      !shader.includes('for(var i=begin;i<end;i++)'),
      'no per-(group, slot) item scan remains',
    );
    assert.ok(
      shader.includes('select(atomicLoad(&slotTally[slot]),0u,slotUsed[slot]==0u)'),
      'an empty slot still reports zero',
    );

    // The prefix reads no group of an empty slot: its run totals and offsets are guarded.
    assert.ok(shader.includes('let used=slotUsed[slot]!=0u;'), 'prefixGroups reads slotUsed');
    assert.ok(
      shader.includes(
        'if(used){for(var group=first;group<last;group++){sum=sum+groupCounts[group*',
      ),
      'the run total of an empty slot reads nothing',
    );
    assert.ok(shader.includes('if(used){\n   var cursor='), 'nor do its offsets');
  }
});
