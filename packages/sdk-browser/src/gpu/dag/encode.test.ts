// Cut encoding contract: the NUMBER of commands a frame opens, sole cause of the wait timestamps
// attribute to no kernel. It depends NEITHER on hierarchy depth NOR on cluster count: six, always.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeDagKernels } from './encode.ts';
import { encodeurTemoin, ressources, LIVE, CAND, DRAWN } from './encode.fixture.ts';

test('a frame opens only six commands, whatever the depth', () => {
  // What the GPU pays between two kernels is counted in COMMANDS, not threads: each compute pass
  // and each copy outside a pass closes the current encoder and opens another. There used to be
  // 3·depth+3 — 42 on the bench's depth-thirteen hierarchy — because each level dispatched
  // indirectly and therefore had to arm its argument. Descent now dispatches flat, in the head
  // pass: three arming copies and three passes, period.
  for (const levelCount of [1, 3, 5]) {
    const { encoder, copies, passes } = encodeurTemoin();
    encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true, levelCount));
    assert.equal(passes.length, 3, 'head, candidates, live');
    assert.equal(copies.length, 3, 'one arming per list whose layout knows no bound');
    assert.equal(passes.length + copies.length, 6);
  }
});

test('the dispatch argument is copied outside a pass, between two cut passes', () => {
  const { encoder, copies, passes } = encodeurTemoin();
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, ressources(true));
  // WebGPU refuses `work` both written and as an argument in the same scope: each arming
  // therefore cuts the pass, and carries only the head word, the other two being one since
  // creation. Only three remain, for the three lists whose layout knows no upper bound: the
  // previous frame's drawn journal, the candidates and the live ones.
  assert.deepEqual(copies, [
    { de: 'work', decalage: DRAWN, vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: CAND, vers: 'dispatchArgs', octets: 4, enPasse: false },
    { de: 'work', decalage: LIVE, vers: 'dispatchArgs', octets: 4, enPasse: false },
  ]);
  assert.deepEqual(passes, new Array(3).fill('WG DAG selection'));
});
