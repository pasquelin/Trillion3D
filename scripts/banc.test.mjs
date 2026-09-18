import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCENE, sceneOf } from './mesure/scene.mjs';
import { ENGINES, engineOf, parseArgs, readOptions } from './mesure/options.mjs';

test('readOptions parses command line arguments correctly', () => {
  const root = '/tmp/test';

  // Test default engine (webgl)
  const result1 = readOptions([], root);
  assert.strictEqual(result1.settings.engine, 'webgl');

  // Test setting engine to webgpu
  const result2 = readOptions(['--moteur=webgpu'], root);
  assert.strictEqual(result2.settings.engine, 'webgpu');

  // Test views parsing
  const result3 = readOptions(['--vues=generale,detail'], root);
  assert.deepStrictEqual(result3.views, ['generale', 'detail']);

  // Test numeric arguments
  const result4 = readOptions(['--images=120', '--largeur=1920', '--hauteur=1080'], root);
  assert.strictEqual(result4.settings.frames, 120);
  assert.strictEqual(result4.settings.width, 1920);
  assert.strictEqual(result4.settings.height, 1080);

  // Test pixelError parsing
  const result5 = readOptions(['--pixelError=0.5,1.0,2.0'], root);
  assert.deepStrictEqual(result5.settings.pixelErrors, [0.5, 1.0, 2.0]);
});

test('readOptions rejects unknown engine', () => {
  const root = '/tmp/test';
  assert.throws(() => readOptions(['--moteur=unknown'], root), /--moteur doit valoir/);
});

test('readOptions accepts an explicit port', () => {
  const root = '/tmp/test';
  const result = readOptions(['--port=3000'], root);
  assert.strictEqual(result.settings.port, 3000);
});

test('readOptions rejects non-numeric arguments', () => {
  const root = '/tmp/test';
  assert.throws(() => readOptions(['--images=abc'], root), /--images doit être un nombre/);
});

test('readOptions rejects negative pixelError', () => {
  const root = '/tmp/test';
  assert.throws(() => readOptions(['--pixelError=-1.0'], root), /--pixelError invalide/);
});

test('readOptions rejects invalid views', () => {
  const root = '/tmp/test';
  assert.throws(() => readOptions(['--vues=invalide'], root), /vue inconnue/);
});

test('sceneOf déduit le nom de la scène du dossier derived du cache', () => {
  assert.strictEqual(sceneOf('/quelque/part/bistro-exterior-derived'), 'bistro-exterior');
  assert.strictEqual(sceneOf('/quelque/part/bistro-exterior-derived/'), 'bistro-exterior');
  assert.strictEqual(sceneOf('/quelque/part/new-york-manhattan-derived'), 'new-york-manhattan');
});

test('sceneOf garde le nom du dossier quand il ne finit pas par -derived', () => {
  assert.strictEqual(sceneOf('/quelque/part/un-cache-a-moi'), 'un-cache-a-moi');
});

test('sceneOf retombe sur la scène par défaut sans cache nommé', () => {
  assert.strictEqual(sceneOf(undefined), DEFAULT_SCENE);
  assert.strictEqual(sceneOf(''), DEFAULT_SCENE);
});

// `--instances` : le nombre de copies que le SDK pose en grille. Une seule par défaut, et seules
// les grilles que `replicateInstances` sait poser sont acceptées.
test('readOptions lit --instances et refuse une grille que le SDK ne sait pas poser', () => {
  const root = '/tmp/test';
  assert.strictEqual(readOptions([], root).settings.instances, 1);
  assert.strictEqual(readOptions(['--instances=9'], root).settings.instances, 9);
  assert.throws(() => readOptions(['--instances=3'], root), /--instances/);
});

test('engineOf donne à un côté son propre moteur, sinon celui de la campagne', () => {
  const flags = parseArgs(['--moteur-avant', 'webgl']);
  assert.strictEqual(engineOf(flags, 'avant', 'webgpu').id, 'exact-cluster-pages');
  assert.strictEqual(engineOf(flags, 'apres', 'webgpu').id, 'webgpu-page-raster');
});

test('engineOf refuse un moteur inconnu pour un côté', () => {
  assert.throws(
    () => engineOf(parseArgs(['--moteur-apres', 'inconnu']), 'apres', 'webgl'),
    /--moteur-apres doit valoir/,
  );
});

test('seuls les moteurs qui dessinent par Three reçoivent les lampes posées par l’hôte', () => {
  assert.strictEqual(ENGINES.webgl.three, true);
  assert.strictEqual(ENGINES.webgl2.three, true);
  assert.strictEqual(ENGINES.webgpu.three, undefined);
});
