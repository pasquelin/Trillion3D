import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prepareWebgpuPreviewAtlas } from './webgpuPreviewAtlas.ts';
import { PREVIEW_LEVEL_SIZES, type TexturePreview } from '../sdk-core/index.ts';

Object.assign(globalThis, {
  GPUTextureUsage: { TEXTURE_BINDING: 4, COPY_DST: 8 },
  GPUBufferUsage: { STORAGE: 128, COPY_DST: 8 },
});

type TextureWrite = {
  layer: number;
  level: number;
  data: Uint8Array;
};
type BufferWrite = { byteOffset: number; values: number[] };

/** The device the preview atlas needs: records every texture and flag-buffer write so a test can
 *  read back state it never exposes directly. */
function fakeDevice() {
  const textureWrites: TextureWrite[] = [];
  const bufferWrites: BufferWrite[] = [];
  const device = {
    createTexture: () => ({ destroy() {}, createView: (options: unknown) => ({ options }) }),
    createBuffer: (options: { size: number }) => ({ size: options.size, destroy() {} }),
    queue: {
      writeTexture(
        destination: { mipLevel: number; origin: [number, number, number] },
        data: Uint8Array,
      ) {
        textureWrites.push({
          layer: destination.origin[2],
          level: destination.mipLevel,
          data: Uint8Array.from(data),
        });
      },
      writeBuffer(
        _buffer: unknown,
        byteOffset: number,
        data: Uint32Array,
        dataOffset = 0,
        size = data.length,
      ) {
        bufferWrites.push({
          byteOffset,
          values: Array.from(data.subarray(dataOffset, dataOffset + size)),
        });
      },
    },
  } as unknown as GPUDevice;
  return { device, textureWrites, bufferWrites };
}

function levelsFilledWith(value: number) {
  return PREVIEW_LEVEL_SIZES.map((size) => new Uint8Array(size * size * 4).fill(value));
}

function preview(texture: number, value: number): TexturePreview {
  return {
    texture,
    image: texture,
    width: 32,
    height: 32,
    sourceKind: 0,
    sourceBufferView: -1,
    sha256: '0'.repeat(64),
    levels: levelsFilledWith(value),
  };
}

// Comportement 11 : couche 0 blanche et prête ; couche sans aperçu blanche et non prête ; une
// couche avec aperçu porte les pixels de l'aperçu mais reste non prête tant que markReady n'a pas
// été appelé.
test('prepareWebgpuPreviewAtlas seeds layer 0 ready-white, a preview-less layer white-and-not-ready, and a preview layer with its pixels but not ready', () => {
  const { device, textureWrites, bufferWrites } = fakeDevice();
  const mapA = new THREE.Texture(),
    mapB = new THREE.Texture();
  const textureIndices = new Map([
    [mapA, 0],
    [mapB, 1],
  ]);
  const atlas = prepareWebgpuPreviewAtlas(device, [mapA, mapB], textureIndices, [preview(1, 42)]);
  assert.equal(atlas.withPreview, 1);
  // Une seule écriture initiale du tampon prêt, avant tout markReady.
  assert.equal(bufferWrites.length, 1);
  assert.deepEqual(bufferWrites[0].values, [1, 0, 0]);
  const layer0Level0 = textureWrites.find((w) => w.layer === 0 && w.level === 0)!;
  assert.deepEqual([...layer0Level0.data.subarray(0, 4)], [255, 255, 255, 255]);
  // Couche 1 (mapA, texture 0, sans aperçu) reste blanche.
  const layer1Level0 = textureWrites.find((w) => w.layer === 1 && w.level === 0)!;
  assert.deepEqual([...layer1Level0.data.subarray(0, 4)], [255, 255, 255, 255]);
  // Couche 2 (mapB, texture 1, aperçu 42) porte les pixels de l'aperçu, pas du blanc.
  const layer2Level0 = textureWrites.find((w) => w.layer === 2 && w.level === 0)!;
  assert.deepEqual([...layer2Level0.data.subarray(0, 4)], [42, 42, 42, 42]);
  atlas.destroy();
});

// Comportement 11 (suite) : le bit ne passe à un qu'après l'appel qui joue le rôle d'`onColorReady`.
test('a preview layer only becomes ready after markReady, as onColorReady would call it', () => {
  const { device, bufferWrites } = fakeDevice();
  const map = new THREE.Texture();
  const textureIndices = new Map([[map, 0]]);
  const atlas = prepareWebgpuPreviewAtlas(device, [map], textureIndices, [preview(0, 7)]);
  assert.equal(bufferWrites.length, 1, 'aucune écriture individuelle avant markReady');
  atlas.markReady([1]);
  assert.equal(bufferWrites.length, 2);
  assert.deepEqual(bufferWrites[1], { byteOffset: 4, values: [1] });
  atlas.destroy();
});

// Comportement 11 (fin) : une texture abandonnée — jamais transférée, donc jamais passée à
// markReady — garde son aperçu pour toujours : son bit ne bouge jamais.
test('an abandoned texture is never marked ready even when a sibling layer is', () => {
  const { device, bufferWrites } = fakeDevice();
  const [mapA, mapB] = [new THREE.Texture(), new THREE.Texture()];
  const textureIndices = new Map([
    [mapA, 0],
    [mapB, 1],
  ]);
  const atlas = prepareWebgpuPreviewAtlas(device, [mapA, mapB], textureIndices, [
    preview(0, 1),
    preview(1, 2),
  ]);
  atlas.markReady([1]);
  assert.ok(
    bufferWrites.every((write) => write.byteOffset !== 8),
    'la couche 2 (mapB), jamais transférée, ne reçoit jamais son écriture individuelle',
  );
  atlas.destroy();
});

// Comportement 12 : markReady est idempotent et ignore tout rang hors bornes.
test('markReady is idempotent and ignores out-of-range layers', () => {
  const { device, bufferWrites } = fakeDevice();
  const map = new THREE.Texture();
  const textureIndices = new Map([[map, 0]]);
  const atlas = prepareWebgpuPreviewAtlas(device, [map], textureIndices, [preview(0, 3)]);
  atlas.markReady([1]);
  assert.equal(bufferWrites.length, 2);
  atlas.markReady([1]);
  assert.equal(bufferWrites.length, 2, 'un rang déjà prêt ne redéclenche pas une écriture');
  atlas.markReady([0, -1, 999, 1.5]);
  assert.equal(
    bufferWrites.length,
    2,
    'couche 0 déjà prête, rangs négatif, hors bornes et non entier tous ignorés',
  );
  atlas.destroy();
});
