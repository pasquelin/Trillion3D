import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeManifestBinary, encodeManifestBinary } from '../packages/sdk-core/src/index.ts';
import { decodePng, encodePng } from '../packages/sdk-node/src/cutout/png.mts';
import { manifest, sha, TEMPLATES } from '../tests/fixtures/manifestBinary.ts';
import { preview } from '../tests/fixtures/manifestBinaryPreview.ts';
import { coverageLevels } from './texture-coverage-levels.ts';

// The compiler's own PNG, Paeth-filtered, decodes to the level 0 its golden recorded.
test('a PNG the compiler reads decodes to its golden texels, a written one round-trips, a short one is refused', () => {
  const png = readFileSync('tests/fixtures/formats/previews/atlas-couleur/base-degrade.png');
  const { width, height, rgba } = decodePng(png);
  assert.deepEqual([width, height], [40, 24]);
  const digest = createHash('sha256').update(rgba).digest('hex');
  assert.equal(digest, 'b4321ad8ab9746b57e5e2f6aff7716207a0e8cf8efbe951558d782f23e5679bf');
  const written = Uint8Array.from({ length: 24 }, (_, i) => i * 11);
  assert.deepEqual(decodePng(encodePng(3, 2, written)).rgba, written);
  const taller = Buffer.from(encodePng(3, 2, written));
  taller[23] = 3; // IHDR's height says 3 rows, the data holds 2: refused, not read as zeros
  assert.throws(() => decodePng(taller), /every row/);
});

/** A 128² chain whose level `k` covers its top rows, `share(k)` of its texels, at alpha 200. */
function chain(atlas: number, texture: number, share: (level: number) => number) {
  const cover = (rgba: Uint8Array, level: number) => {
    const side = Math.max(1, 128 >> level);
    for (let at = 3; at < rgba.length; at += 4)
      rgba[at] = (at >> 2) / side < Math.round(side * share(level)) ? 200 : 100;
    return rgba;
  };
  const entry = { ...preview(texture, 128, 128, texture), atlas, bakedLevels: 1 };
  entry.levels.forEach((rgba, index) => cover(rgba, index + 1));
  return { entry, head: encodePng(128, 128, cover(new Uint8Array(128 * 128 * 4), 0)) };
}

// #44: the head is read from its file, the tail from the sidecar, and each level counted at the
// chain's cutoff against level 0; develop's word 2 counts at 128, a plain chain not at all.
test('each coverage chain is counted at its cutoff at every level, against level 0', async () => {
  const chains = [chain((150 << 8) | 2, 1, (k) => (k === 2 ? 0.25 : 0.5)), chain(2, 2, () => 0.5)];
  const texturePreviews = [...chains, chain(0, 3, () => 0.5)].map((c) => c.entry);
  const url = '{sha}/{kind}-{level}.{format}';
  const encoded = { ...manifest(), texturePreviews, textures: { url } };
  const { manifest: slim, binary } = encodeManifestBinary(encoded, TEMPLATES);
  slim.binary.sha256 = sha('f');
  const read = async (address: string) => {
    assert.match(address, /-0\.png$/, 'only level 0 is above the tail');
    const found = chains.find((c) => address.startsWith(c.entry.sha256));
    assert.ok(found, address);
    return found.head;
  };
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  const counted = await coverageLevels(decodeManifestBinary(slim, buffer as ArrayBuffer), read);
  assert.deepEqual(
    counted.map((c) => [c.texture, c.cutoff, c.levels.map((l) => Math.round(l.relative * 100))]),
    [
      [1, 150, [0, 0, -50, 0, 0, 0, 0, 100]],
      [2, 128, [0, 0, 0, 0, 0, 0, 0, 100]],
    ],
    'a 1 × 1 level covers all or nothing',
  );
  assert.deepEqual(counted[0]?.levels[2]?.size, [32, 32]);
});
