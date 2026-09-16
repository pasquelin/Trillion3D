import test from 'node:test';
import assert from 'node:assert/strict';
import { drawShader } from './gpuDrawShader.ts';

// La compaction indirecte reçoit, par slot, le nombre de lignes que la partition GPU y a comptées
// (`classifyRows`, gpuPartitionClassifyWgsl.ts). Un slot que ce compte dit vide n'a aucune raison
// d'être parcouru par le shader : `slotUsed` porte cette information et la garde de chaque passe
// s'en sert pour sortir avant de parcourir quoi que ce soit pour ce slot.

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
