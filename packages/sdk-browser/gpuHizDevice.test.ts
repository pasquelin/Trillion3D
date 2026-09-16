import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuHiz } from './gpuHiz.ts';
import { hizDevice } from './gpuHizMockDevice.ts';

test('missing compute leaves GPU Hi-Z undefined so the visbuffer cut stays conservative', async () => {
  assert.equal(await createGpuHiz({} as GPUDevice, 32, 32, 4), undefined);
});

test('a Hi-Z resize replaces the this-frame level-0 depth target', async () => {
  const textures: Array<{ format?: string }> = [];
  const device = hizDevice({
    createTexture: ({ format }) => {
      const tex = {
        format,
        destroy() {},
        createView() {
          return { format };
        },
      };
      textures.push(tex);
      return tex;
    },
  });
  const hiz = await createGpuHiz(device, 16, 16, 4);
  assert.ok(hiz);
  const first = hiz.level0;
  assert.equal(hiz.resize(device, 32, 32), true);
  assert.notEqual(hiz.level0, first);
  assert.equal(hiz.width, 32);
  assert.equal(hiz.height, 32);
  assert.ok(textures.filter((texture) => texture.format === 'r32float').length >= 2);
  hiz.dispose();
});

test('sans boîtes attachées le test n’encode rien, et une fois attachées il efface les verdicts', async () => {
  const device = hizDevice();
  const cleared: Array<{ bytes: number }> = [];
  let passes = 0;
  const encoder = {
    clearBuffer(_buffer: unknown, _offset: number, size: number) {
      cleared.push({ bytes: size });
    },
    beginComputePass() {
      passes++;
      return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  const hiz = await createGpuHiz(device, 33, 19, 2);
  assert.ok(hiz);
  // La partition n'est pas montée : rien n'est testé, donc rien n'est rejeté et rien n'est effacé.
  assert.equal(hiz.encodeTest(device, encoder, 2, 2), 0);
  assert.deepEqual(cleared, []);
  assert.equal(passes, 0);
  hiz.attach({} as GPUBuffer, {} as GPUBuffer);
  assert.equal(hiz.encodeTest(device, encoder, 2, 2), 2);
  // Les lignes que l'image ne teste pas sont remises à zéro d'abord : aucune ne garde un verdict.
  assert.deepEqual(cleared, [{ bytes: 8 }]);
  assert.equal(passes, 1);
  // Les mips que la partition lit pour exprimer un rectangle en texels : décalage puis largeur.
  assert.deepEqual(hiz.levels()[0], { offset: 0, width: 33 });
  assert.equal(hiz.levels().length > 1, true);
  hiz.dispose();
});

test('GPU Hi-Z allocates only the current pyramid and releases it on resize', async () => {
  const buffers: Array<{ size: number; destroyed: boolean }> = [];
  const device = hizDevice({
    createBuffer: ({ size }) => {
      const buffer = {
        size,
        destroyed: false,
        destroy() {
          buffer.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
  });
  const hiz = await createGpuHiz(device, 16, 16, 4);
  assert.ok(hiz);
  assert.equal(buffers.length, 4);
  const firstPyramid = buffers[3];
  assert.equal(hiz.resize(device, 32, 32), true);
  assert.equal(firstPyramid.destroyed, true);
  hiz.dispose();
  assert.ok(buffers.every((buffer) => buffer.destroyed));
});
