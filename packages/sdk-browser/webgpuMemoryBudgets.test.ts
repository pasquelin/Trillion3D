import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GEOMETRY_POOL_BUDGET, geometryPoolFor } from './webgpuMemoryBudgets.ts';

const MIB = 1024 * 1024;

test('le pool de géométrie est un réservoir fixe en octets, 512 Mio par défaut comme la référence', () => {
  assert.equal(DEFAULT_GEOMETRY_POOL_BUDGET, 512 * MIB);
  const pool = geometryPoolFor({
    budgetBytes: DEFAULT_GEOMETRY_POOL_BUDGET,
    pageBytes: 1500,
    uniquePages: 1_000_000,
    rootPages: 300,
  });
  assert.equal(pool.slots, Math.floor((512 * MIB) / 1500));
  assert.equal(pool.allocatedBytes, pool.slots * 1500);
  assert.equal(pool.clamp, null);
});

test('le réservoir se ramène à la scène ou au plafond en pages, et se relève jusqu’à la couverture racine', () => {
  const small = geometryPoolFor({
    budgetBytes: 512 * MIB,
    pageBytes: 1500,
    uniquePages: 10,
    rootPages: 2,
  });
  assert.deepEqual([small.slots, small.clamp], [10, 'scene']);
  const capped = geometryPoolFor({
    budgetBytes: 512 * MIB,
    pageBytes: 1500,
    uniquePages: 10_000,
    rootPages: 2,
    maxResidentPages: 64,
  });
  assert.deepEqual([capped.slots, capped.clamp], [64, 'page-cap']);
  // Le plafond de la session, ce que les tables par page dessinable ont taillé.
  const ceiled = geometryPoolFor({
    budgetBytes: 512 * MIB,
    pageBytes: 1500,
    uniquePages: 10_000,
    rootPages: 2,
    ceilingSlots: 300,
  });
  assert.deepEqual([ceiled.slots, ceiled.clamp], [300, 'ceiling']);
  // Un budget de 8 Mio sur des pages de 1 500 octets fait 5 592 fentes : sous 6 000 racines, il est
  // relevé jusqu'à elles — les racines sont toujours résidentes, comme hors pool chez la référence.
  const roots = geometryPoolFor({
    budgetBytes: 8 * MIB,
    pageBytes: 1500,
    uniquePages: 10_000,
    rootPages: 6000,
  });
  assert.deepEqual([roots.slots, roots.clamp], [6000, 'root-cover']);
  assert.throws(
    () => geometryPoolFor({ budgetBytes: 0, pageBytes: 1500, uniquePages: 10, rootPages: 1 }),
    /INVALID_GEOMETRY_POOL_BUDGET/,
  );
});

test('seule la limite de l’appareil borne le réservoir, et ne refuse que si même les racines n’y entrent pas', () => {
  const limits = { maxBufferSize: 1 * MIB, maxStorageBufferBindingSize: 4 * MIB };
  const pool = geometryPoolFor({
    budgetBytes: 512 * MIB,
    pageBytes: 1024,
    uniquePages: 10_000,
    rootPages: 10,
    limits,
  });
  assert.deepEqual([pool.slots, pool.clamp], [1024, 'device-limit']);
  assert.throws(
    () =>
      geometryPoolFor({
        budgetBytes: 512 * MIB,
        pageBytes: 1024,
        uniquePages: 10_000,
        rootPages: 2000,
        limits,
      }),
    /GEOMETRY_POOL_DEVICE_LIMIT/,
  );
});
