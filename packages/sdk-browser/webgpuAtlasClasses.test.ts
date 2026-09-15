import test from 'node:test';
import assert from 'node:assert/strict';
import { planAtlasClasses } from './webgpuAtlasClasses.ts';
import { mipLevelCountFor } from './textureMips.ts';

function device(maxTextureArrayLayers: number, maxSampledTexturesPerShaderStage: number) {
  return {
    limits: { maxTextureArrayLayers, maxSampledTexturesPerShaderStage },
  } as unknown as GPUDevice;
}
/** Miroir de `atlasClassBytes`, pour vérifier ses octets sans jamais l'appeler. */
function classBytes(width: number, height: number, layers: number) {
  let bytes = 0;
  for (let level = 0; level < mipLevelCountFor(width, height); level++)
    bytes += Math.max(1, width >> level) * Math.max(1, height >> level) * 4 * layers;
  return bytes;
}

// Comportement 7 : sans économie possible, le repli à une seule classe est exactement
// l'allocation d'avant ce lot — une texture-tableau à la taille de la plus grande texture.
test('planAtlasClasses replies to a single class, sized like the largest texture, when splitting saves nothing', () => {
  const sizes: Array<[number, number]> = [
    [64, 64],
    [64, 64],
    [64, 64],
  ];
  const plan = planAtlasClasses(device(256, 32), sizes);
  assert.equal(plan.used, 1);
  assert.deepEqual(plan.sizes[0], [64, 64]);
  assert.equal(plan.layers[0], sizes.length + 1);
  assert.ok(plan.slotClass.every((entry) => entry === 0));
});

// Comportement 7 : une seconde classe n'est retenue que si elle économise des octets sur
// l'allocation à une seule classe — ici en isolant des textures bien plus petites que la plus
// grande, ses couches tenant sous la limite de l'appareil.
test('planAtlasClasses keeps a second class only when it saves bytes over the single-class allocation', () => {
  const sizes: Array<[number, number]> = [
    [128, 128],
    [8, 8],
    [8, 8],
    [8, 8],
  ];
  const plan = planAtlasClasses(device(256, 32), sizes);
  assert.equal(plan.used, 2);
  assert.deepEqual(plan.sizes[1], [8, 8]);
  assert.deepEqual(plan.slotClass, [0, 1, 1, 1]);
  assert.deepEqual(plan.layers, [2, 4]);
  const singleBytes = classBytes(128, 128, sizes.length + 1);
  const splitBytes = classBytes(128, 128, 2) + classBytes(8, 8, 4);
  assert.ok(
    splitBytes < singleBytes,
    'le découpage retenu doit peser moins que l’allocation unique',
  );
  assert.equal(plan.bytes[0] + plan.bytes[1], splitBytes);
});

// Comportement 7 : le nombre de classes est borné par maxSampledTexturesPerShaderStage — un
// appareil trop pauvre en textures échantillonnées force le repli à une seule classe, même pour
// la scène qui économiserait des octets avec un appareil plus généreux.
test('planAtlasClasses is bounded to a single class when maxSampledTexturesPerShaderStage is too small', () => {
  const sizes: Array<[number, number]> = [
    [128, 128],
    [8, 8],
    [8, 8],
    [8, 8],
  ];
  const plan = planAtlasClasses(device(256, 4), sizes);
  assert.equal(plan.used, 1);
  assert.deepEqual(plan.sizes[0], [128, 128]);
});
