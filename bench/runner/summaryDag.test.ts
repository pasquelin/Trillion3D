// Summary DAG-stall section: a table per side holding the compiler's stall table row for row, in
// its order, never ranked again, and a line for a side whose cache stalled nowhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stalls } from './summaryDag.ts';
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

test("each side prints the compiler's stall table as it comes, or says it has none", () => {
  // Not in the order a ranking by root triangles would give: the bench keeps the compiler's.
  const table = [stalled(3, 640), stalled(7, 12_544), stalled(8, 640)];
  const report = {
    sides: { avant: {}, apres: {} },
    series: [
      { sides: { avant: { avertissementsDag: null }, apres: { avertissementsDag: null } } },
      {
        sides: {
          avant: { avertissementsDag: null },
          apres: { avertissementsDag: { count: 0, primitives: [], stalled: table } },
        },
      },
    ],
  } as unknown as Report;
  const lines = stalls(report);
  assert.ok(lines.includes('- avant: no stall recorded'));
  const rows = lines.filter((line) => /^\| \d/.test(line));
  assert.deepEqual(rows, [
    '| 3/0 | 640 | seam-locked | 30 | 4 | 9 |',
    '| 7/0 | 12544 | seam-locked | 30 | 4 | 9 |',
    '| 8/0 | 640 | seam-locked | 30 | 4 | 9 |',
  ]);
});
