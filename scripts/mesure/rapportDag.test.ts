// Summary DAG-stall section: a table per side, worst primitive first, at most ten, and a line for
// a side whose cache stalled nowhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stalls } from './rapportDag.ts';
import type { Report } from './report/types.ts';

const stalled = (mesh: number, rootTriangles: number) => ({
  index: mesh,
  mesh,
  primitive: 0,
  rootTriangles,
  cause: 'seam-locked',
  seamVertices: 30,
  lockedVertices: 4,
  uvIslands: 9,
});

test('each side lists its ten worst stalled primitives, or says it has none', () => {
  const primitives = [stalled(3, 640), stalled(7, 12_544), stalled(8, 640)];
  primitives.push(...Array.from({ length: 8 }, (_, i) => stalled(20 + i, 1_000)));
  const report = {
    sides: { avant: {}, apres: {} },
    series: [
      { sides: { avant: { avertissementsDag: null }, apres: { avertissementsDag: null } } },
      {
        sides: {
          avant: { avertissementsDag: null },
          apres: { avertissementsDag: { count: 0, primitives: [], stalled: primitives } },
        },
      },
    ],
  } as unknown as Report;
  const lines = stalls(report);
  assert.ok(lines.includes('- avant: no primitive stalled'));
  const rows = lines.filter((line) => /^\| \d/.test(line));
  assert.equal(rows.length, 10);
  assert.equal(rows[0], '| 7/0 | 12544 | seam-locked | 30 | 4 | 9 |');
  assert.equal(rows[9], '| 3/0 | 640 | seam-locked | 30 | 4 | 9 |');
  assert.ok(!rows.some((row) => row.startsWith('| 8/0')));
});
