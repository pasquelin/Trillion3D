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

// Comportement : l'adresse sautée est celle que le chargeur de l'hôte demandera, par la règle que
// l'appelant lui donne — jamais normalisée ici, sinon un `./` ou un espace encodé par `new URL`
// ferait lire l'image malgré tout.
test('l’adresse d’une image cuite est celle de l’hôte, telle que sa règle l’écrit', () => {
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

// Comportement : une image n'est sautée que si CHAQUE entrée qui la lit est entière ; sans entrée,
// ou en `data:`, elle est lue comme avant.
test('une image n’est sautée que si toutes ses entrées sont entières', () => {
  const urls = bakedImageUrls(
    manifest([entry(0, 2, 2), entry(0, 2, 0), entry(1, 2, 2), entry(2, 2, 2)]),
    [{ uri: 'a.png' }, { uri: 'b.png' }, { uri: 'data:image/png;base64,AAAA' }, { uri: 'c.png' }],
    (uri) => `https://host/${uri}`,
  );
  assert.deepEqual([...urls], ['https://host/b.png']);
});
