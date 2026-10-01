// The cut rule's readiness over a packing counts its host tables, which the CPU total holds beside
// the decoded pages (`../../residency/memoryBudget.ts`): they follow the resident pages, never the
// catalogue (#483 rule 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from '../../page/cut/cutRule.fixture.ts';
import { stripUniforms } from '../../page/cut/cutRuleBackends.fixture.ts';
import { createDagReadiness } from './readiness.ts';
import { packDagSelection } from './pack.ts';

test('the readiness holds nothing until a page is resident, and nothing once all have left', () => {
  const dag = ruleDag(64);
  const { packed } = stripUniforms(dag, 0.1);
  const readiness = createDagReadiness(packed);
  const none = new Uint8Array(packed.pageCount);
  readiness.apply(none);
  assert.equal(readiness.hostBytes, 0);
  readiness.apply(new Uint8Array(packed.pageCount).fill(1));
  assert.ok(readiness.hostBytes > 0);
  readiness.apply(none);
  assert.equal(readiness.hostBytes, 0);
});

test('placements of one primitive hold no state of their own until one of their pages is resident', () => {
  const dag = ruleDag(64);
  const root = {
    world: dag.world,
    pages: dag.pages,
    culling: dag.culling,
    structure: dag.structure,
  };
  const placed = createDagReadiness(packDagSelection([root, root, root]));
  const count = dag.pages.length;
  placed.apply(new Uint8Array(count * 3));
  assert.equal(placed.heldPlacements, 0);
  placed.apply(new Uint8Array(count * 3).fill(1, count, count * 2));
  assert.equal(placed.heldPlacements, 1);
  const single = (resident: number) => {
    const readiness = createDagReadiness(packDagSelection([root]));
    readiness.apply(new Uint8Array(count).fill(resident));
    return Array.from({ length: count }, (_, p) => [
      readiness.isReady(p),
      readiness.isChildReady(p),
    ]);
  };
  const at = (base: number) =>
    Array.from({ length: count }, (_, p) => [
      placed.isReady(base + p),
      placed.isChildReady(base + p),
    ]);
  assert.deepEqual(at(0), single(0));
  assert.deepEqual(at(count), single(1));
  assert.deepEqual(at(count * 2), single(0));
});
