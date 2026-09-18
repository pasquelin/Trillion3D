import test from 'node:test';
import assert from 'node:assert/strict';
import type { TexturePreview } from '../sdk-core/index.ts';
import { bakedLevelJobs } from './webgpuAtlasBakedJobs.ts';

/** Un appareil qui note chaque copie d'image externe, et une image qui note sa fermeture. */
function recorder() {
  const copies: Array<{ mipLevel: number; row: number; count: number; width: number }> = [];
  const device = {
    queue: {
      copyExternalImageToTexture(
        source: { source: { width: number }; origin: [number, number] },
        target: { mipLevel: number; origin: [number, number, number] },
        size: [number, number],
      ) {
        copies.push({
          mipLevel: target.mipLevel,
          row: target.origin[1],
          count: size[1],
          width: size[0],
        });
      },
    },
  } as unknown as GPUDevice;
  return { device, copies };
}
function bitmap(width: number, height: number) {
  const image = { width, height, closed: false, close: () => void (image.closed = true) };
  return image as unknown as ImageBitmap & { closed: boolean };
}
/** Une source 512×256 dont la queue commence au niveau 3 (64 px) : trois niveaux cuits, 0 à 2. */
const preview: TexturePreview = {
  texture: 4,
  image: 4,
  width: 512,
  height: 256,
  sourceKind: 0,
  sourceBufferView: -1,
  atlas: 1,
  sha256: 'c'.repeat(64),
  firstLevel: 3,
  bakedLevels: 3,
  levels: [],
};

// Comportement 1 : un travail par niveau cuit, du plus grossier au plus fin, aucun prêt avant sa
// lecture, chacun aux dimensions de son niveau et dans la pyramide entière de la couche.
test('un travail par niveau cuit, du plus grossier au plus fin, aucun prêt avant sa lecture', () => {
  const { device } = recorder();
  const reads: number[] = [];
  const jobs = bakedLevelJobs({
    device,
    texture: {} as GPUTexture,
    place: { slot: 4, classIndex: 0, layer: 2 },
    preview,
    kind: 'data',
    pyramid: { first: 0, last: 9 },
    read: async (_sha, _atlas, level) => {
      reads.push(level);
      return bitmap(512 >> level, 256 >> level);
    },
  });
  assert.deepEqual(
    jobs.map((job) => [job.level, job.rows, job.bytesPerRow, job.ready, job.stage, job.kind]),
    [
      [2, 64, 512, false, 0, 'data'],
      [1, 128, 1024, false, 0, 'data'],
      [0, 256, 2048, false, 0, 'data'],
    ],
  );
  assert.deepEqual(jobs[0].pyramid, { first: 0, last: 9 });
  assert.equal(reads.length, 0, 'rien n’est lu tant que la file ne le demande pas');
});

// Comportement 2 : la lecture rend le travail prêt, les bandes sont copiées dans le niveau de mip
// de même rang de la couche, et l'image décodée est fermée après la dernière bande.
test('après lecture, les bandes vont dans le niveau de mip du même rang, puis l’image est fermée', async () => {
  const { device, copies } = recorder();
  const image = bitmap(128, 64);
  const [job] = bakedLevelJobs({
    device,
    texture: {} as GPUTexture,
    place: { slot: 4, classIndex: 0, layer: 2 },
    preview,
    kind: 'color',
    pyramid: { first: 0, last: 9 },
    read: async () => image,
  });
  assert.equal(job.level, 2);
  assert.throws(() => job.uploadRows(0, 8), /TEXTURE_LEVEL_NOT_READ/);
  await job.fetch!();
  assert.equal(job.ready, true);
  job.uploadRows(0, 40);
  job.uploadRows(40, 24);
  assert.deepEqual(copies, [
    { mipLevel: 2, row: 0, count: 40, width: 128 },
    { mipLevel: 2, row: 40, count: 24, width: 128 },
  ]);
  assert.equal(image.closed, true, 'l’image décodée ne survit pas à sa dernière bande');
});

// Comportement 3 : une image aux mauvaises dimensions est refusée et fermée ; le travail reste
// non prêt, et la lecture peut être retentée.
test('une image lue aux mauvaises dimensions est refusée, fermée, et le travail reste non prêt', async () => {
  const { device } = recorder();
  const wrong = bitmap(100, 100);
  const [job] = bakedLevelJobs({
    device,
    texture: {} as GPUTexture,
    place: { slot: 4, classIndex: 0, layer: 2 },
    preview,
    kind: 'color',
    pyramid: { first: 0, last: 9 },
    read: async () => wrong,
  });
  await assert.rejects(job.fetch!(), /TEXTURE_LEVEL_SIZE/);
  assert.equal(job.ready, false);
  assert.equal(wrong.closed, true);
});
