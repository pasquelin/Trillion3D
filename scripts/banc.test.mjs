import test from 'node:test';
import assert from 'node:assert/strict';
import { readOptions } from './mesure/options.mjs';

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
  assert.throws(
    () => readOptions(['--moteur=unknown'], root),
    /--moteur doit valoir/,
  );
});

test('readOptions rejects port 5174', () => {
  const root = '/tmp/test';
  assert.throws(
    () => readOptions(['--port=5174'], root),
    /le port 5174 appartient au serveur de l'utilisateur/,
  );
});

test('readOptions accepts valid ports other than 5174', () => {
  const root = '/tmp/test';
  const result = readOptions(['--port=3000'], root);
  assert.strictEqual(result.settings.port, 3000);
});

test('readOptions rejects non-numeric arguments', () => {
  const root = '/tmp/test';
  assert.throws(
    () => readOptions(['--images=abc'], root),
    /--images doit être un nombre/,
  );
});

test('readOptions rejects negative pixelError', () => {
  const root = '/tmp/test';
  assert.throws(
    () => readOptions(['--pixelError=-1.0'], root),
    /--pixelError invalide/,
  );
});

test('readOptions rejects invalid views', () => {
  const root = '/tmp/test';
  assert.throws(
    () => readOptions(['--vues=invalide'], root),
    /vue inconnue/,
  );
});
