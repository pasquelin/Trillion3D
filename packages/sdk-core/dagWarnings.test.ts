import assert from 'node:assert/strict';
import test from 'node:test';
import type { Primitive } from './geometryContracts.ts';
import { dagWarningsDiagnostic } from './dagWarnings.ts';

const primitive = (mesh: number, dag: Primitive['dag']): Primitive =>
  ({ mesh, primitive: 0, pass: 'exact-clusters', pages: [], dag }) as Primitive;

// Comportement : les avertissements écrits par le compilateur remontent en un diagnostic nommé,
// rattachés à leur primitive ; un cache sans avertissement n'en produit aucun.
test('les avertissements de DAG du cache remontent en un diagnostic à l’ouverture', () => {
  const flat = { code: 'DAG_FLAT' as const, roots: 98, pages: 98, groups: { noCollapse: 4 } };
  const diagnostic = dagWarningsDiagnostic([
    primitive(0, { warnings: [] }),
    primitive(1, { warnings: [flat] }),
    primitive(2, null),
  ]);
  assert.equal(diagnostic?.phase, 'dag-warnings');
  assert.deepEqual(diagnostic?.context, {
    count: 1,
    primitives: [{ ...flat, index: 1, mesh: 1, primitive: 0 }],
  });
  assert.equal(dagWarningsDiagnostic([primitive(0, { warnings: [] })]), null);
});
