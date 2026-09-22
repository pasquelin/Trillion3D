// Summary DAG-stall section: a table per side, worst primitive first, and a line for a side
// whose cache warned about nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stalls } from './rapportDag.ts';
import type { Report } from './report/types.ts';

const warned = (mesh: number, rootTriangles: number) => ({
  code: 'DAG_ROOTS',
  mesh,
  primitive: 0,
  rootTriangles,
  cause: 'seam-locked',
  seamVertices: 30,
  lockedVertices: 4,
  uvIslands: 9,
});

test('each side lists its warned primitives worst first, or says it has none', () => {
  const report = {
    sides: { avant: {}, apres: {} },
    series: [
      { sides: { avant: { avertissementsDag: null }, apres: { avertissementsDag: null } } },
      {
        sides: {
          avant: { avertissementsDag: null },
          apres: { avertissementsDag: { primitives: [warned(3, 640), warned(7, 12_544)] } },
        },
      },
    ],
  } as unknown as Report;
  const lines = stalls(report);
  assert.ok(lines.includes('- avant: no primitive warned'));
  const rows = lines.filter((line) => /^\| \d/.test(line));
  assert.deepEqual(rows, [
    '| 7/0 | 12544 | seam-locked | 30 | 4 | 9 |',
    '| 3/0 | 640 | seam-locked | 30 | 4 | 9 |',
  ]);
});
