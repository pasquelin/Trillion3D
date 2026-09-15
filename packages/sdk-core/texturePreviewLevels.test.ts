import test from 'node:test';
import assert from 'node:assert/strict';
import {
  previewFirstLevel,
  previewLastLevel,
  previewLevelCount,
  previewLevelSize,
  previewPixelBytes,
} from './texturePreviewLevels.ts';

// Comportement 5 : la géométrie TypeScript est le miroir exact de
// `packages/asset-compiler-rust/src/texture_preview/levels.rs`, vérifié ici sur les mêmes cas —
// une texture qui tient déjà sous la base, une texture impaire, une texture non carrée.
test('previewFirstLevel/Last/Count/Size/PixelBytes match the Rust geometry on the same cases', () => {
  // 4×4 : tient déjà sous la base, trois niveaux jusqu'au 1×1.
  assert.equal(previewFirstLevel(4, 4), 0);
  assert.equal(previewLastLevel(4, 4), 2);
  assert.equal(previewLevelCount(4, 4), 3);
  assert.equal(previewPixelBytes(4, 4), 84);

  // 17×9 : dimensions impaires et dissemblables, cinq niveaux.
  assert.equal(previewFirstLevel(17, 9), 0);
  assert.equal(previewLastLevel(17, 9), 4);
  assert.equal(previewLevelCount(17, 9), 5);
  assert.deepEqual(previewLevelSize(17, 9, 1), [8, 4]);
  assert.deepEqual(previewLevelSize(17, 9, 4), [1, 1]);
  assert.equal(previewPixelBytes(17, 9), 784);

  // 128×64 : non carrée, sept côtés dépassant la base d'un seul cran.
  assert.equal(previewFirstLevel(128, 64), 1);
  assert.equal(previewLastLevel(128, 64), 7);
  assert.equal(previewLevelCount(128, 64), 7);
  assert.deepEqual(previewLevelSize(128, 64, 1), [64, 32]);
  assert.equal(previewPixelBytes(128, 64), 10_924);
});
