import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import {
  compactRank,
  compactSerial,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';

// D4: shader.ts now compacts retained lights by rank (countOneBits, one thread
// per light) instead of a loop on thread zero. compactSerial (the legacy kernel) and compactRank
// (the D4 kernel) must produce the same list, in the same ascending order, and the same requested
// count, on hostile masks.

const WORDS = Math.ceil(LIGHT_SETTINGS.maxLights / 32);
const MAX_TILE = LIGHT_SETTINGS.maxLightsPerTile;

function assertSame(hits: Uint32Array, count: number, maxTileLights: number = MAX_TILE) {
  const serial = compactSerial(hits, count, maxTileLights);
  const rank = compactRank(hits, count, maxTileLights);
  assert.deepEqual(rank.kept, serial.kept, `kept differs for hits=${[...hits]} count=${count}`);
  assert.equal(
    rank.requested,
    serial.requested,
    `requested differs for hits=${[...hits]} count=${count}`,
  );
  return serial;
}

test('0 lights: zero count, empty mask', () => {
  const result = assertSame(new Uint32Array(WORDS), 0);
  assert.deepEqual(result.kept, []);
  assert.equal(result.requested, 0);
});

test('all masks zero, count at the scene lights ceiling', () => {
  const result = assertSame(new Uint32Array(WORDS), LIGHT_SETTINGS.maxLights);
  assert.deepEqual(result.kept, []);
  assert.equal(result.requested, 0);
});

test('all scene lights retained (LIGHT_SETTINGS.maxLights ceiling)', () => {
  const hits = new Uint32Array(WORDS).fill(0xffffffff);
  const result = assertSame(hits, LIGHT_SETTINGS.maxLights);
  // The per-tile ceiling is lower than the scene lights count: the list stops at the ceiling.
  assert.equal(result.kept.length, MAX_TILE);
  assert.equal(result.requested, LIGHT_SETTINGS.maxLights);
  assert.deepEqual(result.kept, [...Array(MAX_TILE).keys()]);
});

test('strict overflow: one more light than the per-tile ceiling', () => {
  const hits = new Uint32Array(WORDS);
  for (let i = 0; i < MAX_TILE + 1; i++) hits[i >>> 5] |= 1 << (i & 31);
  const result = assertSame(hits, MAX_TILE + 1);
  assert.equal(result.kept.length, MAX_TILE);
  assert.equal(result.requested, MAX_TILE + 1);
});

test('holey mask: every other light retained, including across the 32-bit word boundary', () => {
  const hits = new Uint32Array(WORDS);
  for (let i = 0; i < LIGHT_SETTINGS.maxLights; i += 2) hits[i >>> 5] |= 1 << (i & 31);
  const result = assertSame(hits, LIGHT_SETTINGS.maxLights);
  assert.deepEqual(
    result.kept,
    [...Array(LIGHT_SETTINGS.maxLights).keys()].filter((i) => i % 2 === 0).slice(0, MAX_TILE),
  );
});

test('isolated bit at word boundary (31 and 32)', () => {
  const hits = new Uint32Array(WORDS);
  hits[0] |= 1 << 31;
  if (WORDS > 1) hits[1] |= 1;
  assertSame(hits, LIGHT_SETTINGS.maxLights);
});

test('count below the number of bits set beyond does not count them', () => {
  // A bit set outside [0, count) must never be read: the shader's `lane < count` guard
  // prevents setting it; here we verify both oracles ignore it if set anyway.
  const hits = new Uint32Array(WORDS);
  hits[0] |= 1; // light 0
  hits[0] |= 1 << 5; // light 5, outside the simulated count below
  const serial = compactSerial(hits, 3, MAX_TILE);
  const rank = compactRank(hits, 3, MAX_TILE);
  assert.deepEqual(serial.kept, [0]);
  assert.deepEqual(rank.kept, [0]);
});

test('fuzz: random masks, various counts and per-tile ceilings', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 40; trial++) {
    const hits = new Uint32Array(WORDS);
    const count = 1 + Math.floor(rand() * (LIGHT_SETTINGS.maxLights - 1));
    for (let i = 0; i < count; i++) if (rand() < 0.5) hits[i >>> 5] |= 1 << (i & 31);
    const cap = 1 + Math.floor(rand() * (MAX_TILE - 1));
    assertSame(hits, count, cap);
  }
});
