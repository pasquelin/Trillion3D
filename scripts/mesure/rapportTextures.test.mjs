// Texture lines of the summary: all seventeen pool counters named, readable bytes, nothing invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { textures } from './rapportTextures.mjs';

test('the seventeen virtual texture counters are read in three lines', () => {
  const [pool, retour, diffuseur, , vide] = textures({
    texturePoolBytes: 532_684_800,
    texturePoolFormat: 'rgba8unorm-srgb',
    texturePoolLayers: 4,
    textureTilesResident: 1_212,
    textureResidentBytes: 89_668_608,
    textureTilesRequested: 640,
    textureTilesAtLevel: 612,
    textureMissingLevels: 0.125,
    textureTilesPending: 28,
    textureTilesServed: 3_410,
    textureTilesEvicted: 12,
    textureTilesRefused: 0,
    textureBytesLastFrame: 16_722_688,
    textureLevelReads: 2,
    textureLevelsDecoded: 118,
    textureLevelCacheBytes: 150_994_944,
    textureScratchBuilds: 0,
  });
  assert.equal(
    pool,
    '- Textures: pool 0.533 GB computed in rgba8unorm-srgb, 4 layer(s) per atlas; resident 0.090 GB in 1212 tiles',
  );
  assert.equal(
    retour,
    '- Image feedback: 640 tiles requested, 612 served at the requested level, 0.13 missing ' +
      'level(s) on average, 28 pending',
  );
  assert.equal(
    diffuseur,
    '- Streamer: 3410 tiles served, 12 evicted, 0 refused; last pass 16.7 MB; baked ' +
      'levels 2 in read, 118 decoded, 151.0 MB held; 0 scratch textures',
  );
  assert.equal(vide, '');
});

test('preparation and network are read in seconds and GB per file type', () => {
  const [, , , ligne] = textures({}, { preparationMs: 2345.6, reseau: { png: 1.2e9, bin: 2e8 } });
  assert.equal(ligne, '- Prepare 2.35 s; network since prepare: png 1.200 GB, bin 0.200 GB');
  const [, , , absente] = textures({}, {});
  assert.equal(absente, '- Prepare unmeasured; network since prepare: unmeasured');
});

test('an engine that does not publish textures states them as unmeasured, never zero', () => {
  const [pool, retour, diffuseur] = textures({});
  assert.match(pool, /pool unmeasured computed in unmeasured, unmeasured layer\(s\)/);
  assert.match(retour, /unmeasured tiles requested/);
  assert.match(diffuseur, /baked levels unmeasured in read/);
  for (const ligne of [pool, retour, diffuseur]) assert.doesNotMatch(ligne, /\b0 (GB|MB|tiles)\b/);
  assert.equal(textures(null)[0], textures(undefined)[0]);
});
