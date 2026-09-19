import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClusterManifest, TexturePreview } from '../sdk-core/index.ts';
import { bakedImageUrls } from './sceneTextureSkip.ts';

const entry = (image: number, firstLevel: number, bakedLevels: number): TexturePreview => ({
  texture: image,
  image,
  width: 256,
  height: 256,
  sourceKind: 0,
  sourceBufferView: -1,
  sha256: '0'.repeat(64),
  atlas: 0,
  firstLevel,
  bakedLevels,
  levels: [],
});
const manifest = (previews: TexturePreview[]): ClusterManifest =>
  ({ textures: { url: 'x' }, texturePreviews: previews }) as unknown as ClusterManifest;

// Behaviour: the skipped address is the one the host loader will ask for, by the rule the
// caller gives it — never normalised here, or a `./` or a space encoded by `new URL`
// would still read the image.
test("a baked image address is the host's, as its rule writes it", () => {
  const urls = bakedImageUrls(
    manifest([entry(0, 2, 2), entry(1, 2, 2)]),
    [{ uri: './tex/a.png' }, { uri: 'tex/b c.png' }],
    (uri) => `https://host/scenes/emerald/${uri}`,
  );
  assert.deepEqual(
    [...urls],
    ['https://host/scenes/emerald/./tex/a.png', 'https://host/scenes/emerald/tex/b c.png'],
  );
});

// Behaviour: an image is skipped only if every entry that reads it is whole; with no entry,
// or as `data:`, it is read as before.
test('an image is skipped only if all of its entries are whole', () => {
  const urls = bakedImageUrls(
    manifest([entry(0, 2, 2), entry(0, 2, 0), entry(1, 2, 2), entry(2, 2, 2)]),
    [{ uri: 'a.png' }, { uri: 'b.png' }, { uri: 'data:image/png;base64,AAAA' }, { uri: 'c.png' }],
    (uri) => `https://host/${uri}`,
  );
  assert.deepEqual([...urls], ['https://host/b.png']);
});
