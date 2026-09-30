import test from 'node:test';
import assert from 'node:assert/strict';
import { ltcTable } from './ltcTable.ts';

test('every fitted light transform preserves orientation and has a nonzero tangent scale', () => {
  const table = ltcTable();
  for (let offset = 0; offset < table.length; offset += 8) {
    const [xx, xz, zx, zz] = table.slice(offset, offset + 4);
    assert.ok(xx > 0, `cell ${offset / 8} has no tangent scale`);
    assert.ok(xx * zz - xz * zx > 0, `cell ${offset / 8} is singular or reverses orientation`);
  }
});
