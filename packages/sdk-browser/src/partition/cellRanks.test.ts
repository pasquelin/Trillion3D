import test from 'node:test';
import assert from 'node:assert/strict';
import type { TableCell } from '../../../sdk-core/src/scene/core/tablePartition.ts';
import { walked } from './paged.fixture.ts';

test('a cell is numbered by its cook rank, whatever page the view opens first (#1237)', () => {
  // The world roots name a cell by its rank in the cook's records: a camera at the far end of a
  // row of sixteen cells opens the last region pages alone, and their cells keep those ranks.
  const cells: TableCell[] = Array.from({ length: 16 }, (_, at) => ({
    ...{ url: `cell-${at}.json`, sha256: '', bytes: 1, meshes: [[0, 1] as const], meshPages: [] },
    parents: [[null, [10 * at, 0, 0, 10 * at + 10, 10, 1]]],
  }));
  const { index, found } = walked(cells, [155, 5, 0.5], 5);
  assert.ok(found.length > 0 && found.every((cell) => cell >= 12), JSON.stringify(found));
  for (const cell of found)
    assert.equal(index.cell(cell).url, `https://cache.test/cell-${cell}.json`, `cell ${cell}`);
});
