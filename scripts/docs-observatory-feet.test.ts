import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCacheManifest } from '../bench/runner/cacheManifest.ts';
import { decodeGeometryPage } from '../packages/sdk-browser/src/page/decode/geometryPage.ts';
import { sceneCacheFiles } from '../tests/kit/scenes/caches.ts';
import type { Block } from './docs/observatory/geometry.ts';
import { createObservatory, paving } from './docs/observatory/scene.ts';

const root = new URL('../', import.meta.url);
const bottom = (block: Block) => block.center[1] - block.size[1] / 2;
const top = (block: Block) => block.center[1] + block.size[1] / 2;

/** Each foot of the authored observatory: a block narrower than a stone, over one, whose base
 *  reaches down to its top, with that stone. */
function feet() {
  const { blocks } = createObservatory();
  const stones = blocks.filter((block) => block.size === paving.size);
  return blocks.flatMap((block) => {
    if (block.size[0] >= paving.size[0] || block.size[2] >= paving.size[2]) return [];
    const stone = stones.find((candidate) =>
      [0, 2].every(
        (axis) => Math.abs(block.center[axis] - candidate.center[axis]) <= candidate.size[axis] / 2,
      ),
    );
    return stone && bottom(block) <= top(stone) + 1e-9 && top(block) > top(stone)
      ? [{ block, stone }]
      : [];
  });
}

test('each arcade plinth rests on the paving stone under it, centred on it', () => {
  const found = feet();
  assert.equal(found.length, 8, 'two arcades of four plinths');
  for (const { block, stone } of found) {
    const at = `plinth at ${block.center.join(', ')}`;
    assert.ok(Math.abs(bottom(block) - top(stone)) < 1e-9, `${at}: bottom on the stone's top`);
    for (const axis of [0, 2])
      assert.ok(
        Math.abs(block.center[axis] - stone.center[axis]) < 1e-9,
        `${at}: centred on its stone`,
      );
  }
});

test("the compiled observatory decodes each plinth's corners within 1e-4 m of the source", async () => {
  const [pointer] = (await sceneCacheFiles('manifest.json')).filter((file) =>
    file.startsWith('site/assets/gallery/signature-architecture/'),
  );
  assert.ok(pointer, 'the observatory cache is compiled (pnpm run compile:caches)');
  const { dir, manifest } = readCacheManifest(fileURLToPath(new URL(dirname(pointer), root)));
  // The full-detail pages, decoded by the engine's own page decoder.
  const positions = manifest.primitives
    .flatMap((primitive) => primitive.pages)
    .flatMap((page) =>
      page.role === 'exact' && page.geometry
        ? [decodeGeometryPage(new Uint8Array(readFileSync(join(dir, page.geometry.url))))]
        : [],
    )
    .map((decoded) => decoded.attributes.position);
  const found = feet();
  assert.equal(found.length, 8, 'two arcades of four plinths');
  for (const { block } of found)
    for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const at = block.center.map(
        (c, axis) => c + (corner & (1 << axis) ? 0.5 : -0.5) * block.size[axis],
      );
      let gap = Infinity;
      for (const position of positions)
        for (let i = 0; i < position.length; i += 3)
          gap = Math.min(
            gap,
            Math.hypot(position[i] - at[0], position[i + 1] - at[1], position[i + 2] - at[2]),
          );
      assert.ok(gap <= 1e-4, `plinth corner ${at.join(', ')}: nearest decoded vertex ${gap} m`);
    }
});
