import assert from 'node:assert/strict';
import test from 'node:test';
import type { Primitive } from './geometry.ts';
import { dagWarningsDiagnostic } from './dagWarnings.ts';

const primitive = (mesh: number, dag: Primitive['dag']): Primitive =>
  ({ mesh, primitive: 0, pass: 'exact-clusters', pages: [], dag }) as Primitive;

// Behavior: compiler warnings and every primitive with a stalled group, warned about or not,
// surface as a named diagnostic attached to their primitive; a clean cache produces none.
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
  const diagnostic = dagWarningsDiagnostic([
    primitive(0, { warnings: [], stalls: [stall], ...summary, lockedVertices: 5, uvIslands: 1 }),
    primitive(1, { warnings: [flat] }),
    primitive(2, null),
  ]);
  assert.equal(diagnostic?.phase, 'dag-warnings');
  assert.deepEqual(diagnostic?.context, {
    count: 1,
    primitives: [{ ...flat, index: 1, mesh: 1, primitive: 0 }],
    stalled: [{ index: 0, mesh: 0, primitive: 0, ...summary, lockedVertices: 5, uvIslands: 1 }],
  });
  assert.equal(dagWarningsDiagnostic([primitive(0, { warnings: [] })]), null);
});
