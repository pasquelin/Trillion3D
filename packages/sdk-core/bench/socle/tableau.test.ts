// One row rendered once: the witness gap follows the baseline gap and carries no regression icon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { entete, ligneMd } from './tableau.ts';
import type { LigneResultat } from './mesure.ts';

test('the table prints the witness gap after the baseline gap, without a regression icon', () => {
  assert.match(entete()[0], /\| vs baseline \| vs witness \| Oracle \|/);
  const row: LigneResultat = {
    name: 'r',
    size: null,
    medianeMs: null,
    p95Ms: null,
    minMs: null,
    nsParElement: null,
    tours: 0,
    opsParSec: null,
    temoin: null,
    ecartBaseline: 0.3,
    ecartTemoin: -0.5,
    correct: true,
    difference: null,
    motif: null,
  };
  assert.match(ligneMd(row, { pastilles: true }), /\| 🔴 \+30\.0 % \| -50\.0 % \| ✓ \|/);
  assert.match(ligneMd({ ...row, ecartTemoin: null }), /\| \+30\.0 % \| — \| ✓ \|/);
});
