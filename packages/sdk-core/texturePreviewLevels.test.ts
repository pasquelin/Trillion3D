import test from 'node:test';
import assert from 'node:assert/strict';
import {
  previewFirstLevel,
  previewGeometry,
  previewLastLevel,
  previewLevelCount,
  previewLevelSize,
  previewPixelBytes,
} from './texturePreviewLevels.ts';
import { referenceExpectedGeometry } from './bench/oracles/g-preview.mjs';

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

// G11 : `previewGeometry` calcule le premier et le dernier niveau une seule fois puis en déduit les
// trois nombres, au lieu que `manifestBinaryPreview.ts` appelle `previewFirstLevel`/`previewLevelCount`/
// `previewPixelBytes` séparément (chacune recalculant les mêmes bornes). Oracle : cette ancienne
// combinaison, recopiée telle quelle dans `bench/oracles/g-preview.mjs`.
test('previewGeometry rend exactement ce que les trois appels séparés rendaient, cas hostiles compris', () => {
  const cas: [number, number][] = [
    [0, 0],
    [1, 1],
    [63, 63],
    [64, 64],
    [65, 65],
    [17, 9],
    [128, 64],
    [1, 100000],
    [100000, 1],
    [65536, 65536],
    [-1, -1],
    [-7, 20],
  ];
  for (const [width, height] of cas)
    assert.deepEqual(
      previewGeometry(width, height),
      referenceExpectedGeometry(width, height),
      `${width}x${height}`,
    );
});
