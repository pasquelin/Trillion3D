import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CLUSTERED_BLEND_FORMAT_VERSION } from '../packages/sdk-core/src/contracts/base.ts';
import type { ClusterManifest } from '../packages/sdk-core/src/contracts/index.ts';
import { encodeManifestBinary } from '../packages/sdk-core/src/manifest/binary.ts';
import { decodePng, encodePng } from '../packages/sdk-node/src/cutout/png.mts';
import { TEMPLATES, sha } from '../tests/fixtures/manifestBinary.ts';
import { preview } from '../tests/fixtures/manifestBinaryPreview.ts';
import { coverageLevels } from './texture-coverage-levels.ts';

// The compiler's PNG, Paeth-filtered, decodes to the texels the golden recorded for its level 0.
test('a PNG the compiler reads decodes to its golden texels, and a written one round-trips', () => {
  const golden = readFileSync('tests/fixtures/formats/previews/atlas-couleur/base-degrade.png');
  const decoded = decodePng(golden);
  assert.deepEqual([decoded.width, decoded.height], [40, 24]);
  const digest = createHash('sha256').update(decoded.rgba).digest('hex');
  assert.equal(digest, 'b4321ad8ab9746b57e5e2f6aff7716207a0e8cf8efbe951558d782f23e5679bf');
  const rgba = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => i * 11);
  assert.deepEqual(decodePng(encodePng(3, 2, rgba)).rgba, rgba);
});

/** A 128² coverage chain whose every level covers its top rows up to `share` of the texels. */
function chain(atlas: number, texture: number, share: (level: number) => number) {
  const rows = (rgba: Uint8Array, level: number) => {
    const side = Math.max(1, 128 >> level);
    for (let at = 3; at < rgba.length; at += 4) {
      const covered = Math.floor((at >> 2) / side) < Math.round(side * share(level));
      rgba[at] = covered ? 200 : 100;
    }
    return rgba;
  };
  const entry = { ...preview(texture, 128, 128, texture), atlas, bakedLevels: 1 };
  entry.levels.forEach((rgba, index) => rows(rgba, index + 1));
  return { entry, head: encodePng(128, 128, rows(new Uint8Array(128 * 128 * 4), 0)) };
}

// #44: the measurer's tool reads the head from its file, the tail from the sidecar, and counts
// each level's texels at or above the chain's cutoff against level 0; develop's word 2 counts at
// 128, a plain chain is not a coverage chain.
test('each coverage chain is counted at its cutoff at every level, against level 0', async () => {
  const cut = chain((150 << 8) | 2, 1, (level) => (level === 2 ? 0.25 : 0.5));
  const uncut = chain(2, 2, () => 0.5);
  const plain = chain(0, 3, () => 0.5);
  const { manifest: slim, binary } = encodeManifestBinary(
    {
      schema: CLUSTERED_BLEND_FORMAT_VERSION,
      status: 'ready',
      primitives: [],
      texturePreviews: [cut.entry, uncut.entry, plain.entry],
      textures: { url: '{sha}/{kind}-{level}.{format}' },
    } as unknown as ClusterManifest,
    TEMPLATES,
  );
  slim.binary.sha256 = sha('f');
  const heads = new Map([cut, uncut].map(({ entry, head }) => [entry.sha256, head]));
  const read = async (url: string) => {
    assert.match(url, /-0\.png$/, 'only level 0 is above the tail');
    const head = heads.get(url.split('/')[0] ?? '');
    assert.ok(head, url);
    return head;
  };
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  const chains = await coverageLevels(slim, buffer as ArrayBuffer, read);
  assert.deepEqual(
    chains.map((c) => [c.texture, c.cutoff, c.levels.length]),
    [
      [1, 150, 8],
      [2, 128, 8],
    ],
  );
  const relative = chains[0]?.levels.map((level) => Math.round(level.relative * 100));
  assert.deepEqual(relative, [0, 0, -50, 0, 0, 0, 0, 100], 'a 1 × 1 level covers all or nothing');
  assert.deepEqual(chains[0]?.levels[2]?.size, [32, 32]);
});
