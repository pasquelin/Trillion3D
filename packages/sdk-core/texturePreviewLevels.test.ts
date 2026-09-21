import test from 'node:test';
import assert from 'node:assert/strict';
import {
  levelBlockBytes,
  previewBlockBytes,
  previewFirstLevel,
  previewGeometry,
  previewLastLevel,
  previewLevelCount,
  previewLevelSize,
  previewPixelBytes,
} from './texturePreviewLevels.ts';
import { referenceExpectedGeometry } from './bench/oracles/preview-texture.ts';

// Behaviour 5: the TypeScript geometry is the exact mirror of
// `packages/asset-compiler-rust/src/texture_preview/levels.rs`, checked here on the same cases —
// a texture that already fits under the base, an odd texture, a non-square texture.
test('previewFirstLevel/Last/Count/Size/PixelBytes match the Rust geometry on the same cases', () => {
  // 4×4: already fits under the base, three levels down to 1×1.
  assert.equal(previewFirstLevel(4, 4), 0);
  assert.equal(previewLastLevel(4, 4), 2);
  assert.equal(previewLevelCount(4, 4), 3);
  assert.equal(previewPixelBytes(4, 4), 84);

  // 17×9: odd and dissimilar dimensions, five levels.
  assert.equal(previewFirstLevel(17, 9), 0);
  assert.equal(previewLastLevel(17, 9), 4);
  assert.equal(previewLevelCount(17, 9), 5);
  assert.deepEqual(previewLevelSize(17, 9, 1), [8, 4]);
  assert.deepEqual(previewLevelSize(17, 9, 4), [1, 1]);
  assert.equal(previewPixelBytes(17, 9), 784);

  // 128×64: non-square, seven sides exceeding the base by a single step.
  assert.equal(previewFirstLevel(128, 64), 1);
  assert.equal(previewLastLevel(128, 64), 7);
  assert.equal(previewLevelCount(128, 64), 7);
  assert.deepEqual(previewLevelSize(128, 64, 1), [64, 32]);
  assert.equal(previewPixelBytes(128, 64), 10_924);
});

// G11: `previewGeometry` computes the first and last level once then derives the
// three numbers, instead of `manifestBinaryPreview.ts` calling `previewFirstLevel`/`previewLevelCount`/
// `previewPixelBytes` separately (each recomputing the same bounds). Oracle: this old
// combination, copied as-is into `bench/oracles/preview-texture.ts`.
test('previewGeometry yields exactly what the three separate calls yielded, hostile cases included', () => {
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
  for (const [width, height] of cas) {
    const { blockBytes: _blocks, sizes: _sizes, ...geometry } = previewGeometry(width, height);
    assert.deepEqual(geometry, referenceExpectedGeometry(width, height), `${width}x${height}`);
  }
});

// Behaviour: a block-compressed tail is whole 4×4 blocks of sixteen bytes per level — a 1×1
// level costs one block —, the same count in both formats, mirror of `levels.rs`.
test('previewBlockBytes counts whole blocks per carried level', () => {
  // 4×4: one block at 4×4, one at 2×2, one at 1×1.
  assert.equal(previewBlockBytes(4, 4), 3 * 16);
  assert.equal(levelBlockBytes(17, 9), 5 * 3 * 16);
  // 17×9 → 17×9, 8×4, 4×2, 2×1, 1×1: 15 + 2 + 1 + 1 + 1 blocks.
  assert.equal(previewBlockBytes(17, 9), 20 * 16);
  // 128×64 tail starts at 64×32: 128 + 32 + 8 + 2 + 1 + 1 + 1 blocks.
  assert.equal(previewBlockBytes(128, 64), 173 * 16);
});
