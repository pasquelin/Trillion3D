import assert from 'node:assert/strict';
import test from 'node:test';
import type { Primitive } from './geometry.ts';
import { dagWarningsDiagnostic } from './dagWarnings.ts';

const primitive = (mesh: number, dag: Primitive['dag']): Primitive =>
  ({ mesh, primitive: 0, pass: 'exact-clusters', pages: [], dag }) as Primitive;

// Behavior: compiler warnings surface as a named diagnostic attached to their primitive, with the
// compiler's stall table as it is, not rebuilt from the primitives; a clean cache produces none.
test('DAG warnings from cache surface as a diagnostic on open', () => {
  const flat = {
    code: 'DAG_FLAT' as const,
    roots: 98,
    pages: 98,
    groups: { seamLocked: 4 },
    rootTriangles: 12544,
    cause: 'seam-locked' as const,
    seamVertices: 300,
    lockedVertices: 40,
    uvIslands: 98,
  };
  const stall = {
    level: 0,
    cause: 'border-locked' as const,
    triangles: 64,
    seamVertices: 2,
    lockedVertices: 5,
    uvIslands: 1,
  };
  const summary = { rootTriangles: 64, cause: 'border-locked' as const, seamVertices: 2 };
  const row = { index: 0, mesh: 0, primitive: 0, ...summary, lockedVertices: 5, uvIslands: 1 };
  const primitives = [
    primitive(0, { warnings: [], stalls: [stall], ...summary, lockedVertices: 5, uvIslands: 1 }),
    primitive(1, { warnings: [flat] }),
    primitive(2, null),
  ];
  const diagnostic = dagWarningsDiagnostic({ primitives, worstStalls: [row] });
  assert.equal(diagnostic?.phase, 'dag-warnings');
  assert.deepEqual(diagnostic?.context, {
    count: 1,
    primitives: [{ ...flat, index: 1, mesh: 1, primitive: 0 }],
    stalled: [row],
  });
  // No warning and an empty stall table: nothing is said, even if a primitive's report has stalls.
  assert.equal(
    dagWarningsDiagnostic({ primitives: primitives.slice(0, 1), worstStalls: [] }),
    null,
  );
});

test('warnings and stalls each raise the diagnostic alone, the manifest left as it was', () => {
  const warning = { code: 'MULTIPLE_ROOTS', index: 99, mesh: 99, primitive: 99 };
  const stalled = [{ mesh: 4, primitive: 2 }];
  const primitives = [
    { mesh: 3, primitive: 7, dag: { warnings: [warning] } },
    { mesh: 5, primitive: 8 },
    { mesh: 9, primitive: 11, dag: { warnings: [] } },
  ] as unknown as Primitive[];
  const diagnostic = dagWarningsDiagnostic({ primitives, worstStalls: stalled as never })!;
  assert.equal(diagnostic.phase, 'dag-warnings');
  // Its words count both tables for a person.
  assert.ok(diagnostic.message.includes('1 primitive(s)'), diagnostic.message);
  assert.ok(diagnostic.message.includes('1 in the compiler'), diagnostic.message);
  assert.deepEqual(diagnostic.context, {
    count: 1,
    primitives: [{ code: 'MULTIPLE_ROOTS', index: 0, mesh: 3, primitive: 7 }],
    stalled,
  });
  assert.equal(warning.index, 99);
  assert.ok(dagWarningsDiagnostic({ primitives: [], worstStalls: stalled as never }));
  assert.ok(dagWarningsDiagnostic({ primitives }));
  assert.equal(dagWarningsDiagnostic({ primitives: [] }), null);
});
