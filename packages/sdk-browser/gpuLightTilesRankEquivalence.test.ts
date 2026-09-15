import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../sdk-core/index.ts';
import { compactRank, compactSerial } from './bench/oracles/gpuLightTilesRankOracle.ts';

// D4 : gpuLightTilesShader.ts compacte desormais les lampes retenues par rang (countOneBits, un fil
// par lampe) au lieu d'une boucle sur le fil zero. compactSerial (l'ancien noyau) et compactRank
// (celui du lot D4) doivent produire la meme liste, dans le meme ordre croissant, et le meme compte
// demande, sur des masques hostiles.

const WORDS = Math.ceil(LIGHT_SETTINGS.maxLights / 32);
const MAX_TILE = LIGHT_SETTINGS.maxLightsPerTile;

function assertSame(hits: Uint32Array, count: number, maxTileLights = MAX_TILE) {
  const serial = compactSerial(hits, count, maxTileLights);
  const rank = compactRank(hits, count, maxTileLights);
  assert.deepEqual(rank.kept, serial.kept, `kept diffère pour hits=${[...hits]} count=${count}`);
  assert.equal(
    rank.requested,
    serial.requested,
    `requested diffère pour hits=${[...hits]} count=${count}`,
  );
  return serial;
}

test('0 lampe : count nul, masque vide', () => {
  const result = assertSame(new Uint32Array(WORDS), 0);
  assert.deepEqual(result.kept, []);
  assert.equal(result.requested, 0);
});

test('tous les masques a zero, count au plafond des lampes de la scene', () => {
  const result = assertSame(new Uint32Array(WORDS), LIGHT_SETTINGS.maxLights);
  assert.deepEqual(result.kept, []);
  assert.equal(result.requested, 0);
});

test('toutes les lampes de la scene retenues (plafond LIGHT_SETTINGS.maxLights)', () => {
  const hits = new Uint32Array(WORDS).fill(0xffffffff);
  const result = assertSame(hits, LIGHT_SETTINGS.maxLights);
  // Le plafond par tuile est plus bas que le nombre de lampes de la scene : la liste s'arrete a lui.
  assert.equal(result.kept.length, MAX_TILE);
  assert.equal(result.requested, LIGHT_SETTINGS.maxLights);
  assert.deepEqual(result.kept, [...Array(MAX_TILE).keys()]);
});

test('debordement strict : une lampe de plus que le plafond par tuile', () => {
  const hits = new Uint32Array(WORDS);
  for (let i = 0; i < MAX_TILE + 1; i++) hits[i >>> 5] |= 1 << (i & 31);
  const result = assertSame(hits, MAX_TILE + 1);
  assert.equal(result.kept.length, MAX_TILE);
  assert.equal(result.requested, MAX_TILE + 1);
});

test('masque troue : une lampe sur deux retenue, y compris a la frontiere du mot 32', () => {
  const hits = new Uint32Array(WORDS);
  for (let i = 0; i < LIGHT_SETTINGS.maxLights; i += 2) hits[i >>> 5] |= 1 << (i & 31);
  const result = assertSame(hits, LIGHT_SETTINGS.maxLights);
  assert.deepEqual(
    result.kept,
    [...Array(LIGHT_SETTINGS.maxLights).keys()].filter((i) => i % 2 === 0).slice(0, MAX_TILE),
  );
});

test('bit isole a la frontiere du mot (31 et 32)', () => {
  const hits = new Uint32Array(WORDS);
  hits[0] |= 1 << 31;
  if (WORDS > 1) hits[1] |= 1;
  assertSame(hits, LIGHT_SETTINGS.maxLights);
});

test('count inferieur au nombre de bits poses au-dela ne les compte pas', () => {
  // Un bit pose hors de [0, count) ne doit jamais etre lu : la garde `lane<count` du shader
  // l'empeche d'etre pose ; on verifie ici que les deux oracles l'ignorent si on le pose quand meme.
  const hits = new Uint32Array(WORDS);
  hits[0] |= 1; // lampe 0
  hits[0] |= 1 << 5; // lampe 5, hors du compte simule ci-dessous
  const serial = compactSerial(hits, 3, MAX_TILE);
  const rank = compactRank(hits, 3, MAX_TILE);
  assert.deepEqual(serial.kept, [0]);
  assert.deepEqual(rank.kept, [0]);
});

test('fuzz : masques aleatoires, plusieurs comptes et plafonds par tuile', () => {
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
