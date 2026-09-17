import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTexturePump } from './webgpuTexturePump.ts';
import { createTextureBudget } from './textureBudget.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';

/** Un plafond que rien n'atteint : ces bancs éprouvent la pompe, pas le registre d'octets. */
const OPEN_LEDGER = { budget: Number.MAX_SAFE_INTEGER, allocated: () => 0, scoreOf: () => 0 };

function scriptedJob(
  overrides: { layer?: number; rows: number; bytesPerRow: number },
  uploadRows: TextureJob['uploadRows'],
): TextureJob {
  const layer = overrides.layer ?? 1;
  return {
    kind: 'color',
    slot: layer,
    classIndex: 0,
    layer,
    level: 0,
    stage: 1,
    bytes: overrides.rows * overrides.bytesPerRow,
    rows: overrides.rows,
    bytesPerRow: overrides.bytesPerRow,
    nextRow: 0,
    failures: 0,
    uploadRows,
  };
}

/** A pump wired to a real (mock) GPU device, so a completed colour layer really regenerates mips. */
function buildPump(jobs: TextureJob[], budget: number, order?: (jobs: TextureJob[]) => void) {
  installGpuGlobals();
  const { device, submits } = mockGpu();
  const size: [number, number] = [4, 4];
  const texture = device.createTexture({
    size: { width: size[0], height: size[1], depthOrArrayLayers: 4 },
    format: 'rgba8unorm-srgb',
  }) as unknown as GPUTexture;
  const colorAtlas = {
    classes: [
      {
        texture,
        view: {} as GPUTextureView,
        size,
        layers: 4,
        bytes: 0,
        // Une échelle uv par couche, comme l'atlas réel en alloue une par couche.
        scales: Array.from({ length: 4 }, () => [1, 1]) as Array<[number, number]>,
      },
    ],
    used: 1,
    slotWords: new Uint32Array(4),
    texels: new Float64Array(4),
    bytes: 0,
    destroy() {},
  };
  const colorReady: number[][] = [];
  const levels: Array<[number, number]> = [];
  const failures: Array<{ phase: string; error: unknown }> = [];
  const abandons: Array<Record<string, unknown>> = [];
  const pump = createWebgpuTexturePump({
    device,
    jobs,
    budget,
    colorAtlas: () => colorAtlas,
    dataAtlas: () => undefined,
    ledger: createTextureBudget(OPEN_LEDGER),
    order: order ?? (() => {}),
    onResident: () => {},
    screenKnown: () => true,
    onLevel: (slot, level) => levels.push([slot, level]),
    onColorReady: (slots) => colorReady.push([...slots]),
    onFailure: (phase, error) => failures.push({ phase, error }),
    onAbandon: (context) => abandons.push(context),
  });
  return { pump, submits, colorReady, levels, failures, abandons };
}

test('une texture plus grosse que le budget d’une image arrive complète en plusieurs pompes, jamais dans textureSkipped', () => {
  const log: Array<{ row: number; count: number }> = [];
  const job = scriptedJob({ rows: 4, bytesPerRow: 8 }, (row, count) => log.push({ row, count }));
  const { pump } = buildPump([job], 8);
  for (let i = 0; i < 4; i++) {
    pump.pump();
    assert.equal(pump.skipped, 0);
  }
  assert.equal(pump.uploaded, 1);
  assert.deepEqual(
    log.map((entry) => entry.row),
    [0, 1, 2, 3],
  );
});

test('le budget n’est dépassé que par la première ligne d’une image, jamais après', () => {
  const jobA = scriptedJob({ rows: 1, bytesPerRow: 5 }, () => {});
  const jobB = scriptedJob({ layer: 2, rows: 2, bytesPerRow: 10 }, () => {});
  const { pump } = buildPump([jobA, jobB], 5);
  pump.pump();
  assert.equal(pump.bytesLastPass, 5, 'jobA tient exactement dans le budget');
  assert.equal(jobB.nextRow, 0, 'jobB, second de cette image, n’a pas reçu de ligne en trop');
  pump.pump();
  assert.equal(jobB.nextRow, 1, 'jobB, premier de cette nouvelle image, peut dépasser une fois');
  assert.equal(pump.bytesLastPass, 10);
});

test('markReady et la régénération des mips ne sont déclenchés qu’une fois, après la dernière tranche', () => {
  const job = scriptedJob({ rows: 2, bytesPerRow: 4 }, () => {});
  const { pump, submits, colorReady } = buildPump([job], 4);
  pump.pump();
  assert.equal(colorReady.length, 0);
  assert.equal(submits.length, 0);
  pump.pump();
  assert.deepEqual(colorReady, [[1]]);
  assert.equal(submits.length, 1);
  pump.pump();
  assert.equal(colorReady.length, 1, 'plus aucun appel une fois la file vide');
  assert.equal(submits.length, 1);
});

test('trois `uploadRows` qui lèvent sortent la texture de la file sans réessai ; deux échecs puis un succès la transfèrent en entier', () => {
  const refused = scriptedJob({ rows: 2, bytesPerRow: 4 }, () => {
    throw new Error('DEVICE_REFUSED');
  });
  const { pump, failures, abandons } = buildPump([refused], 4);
  pump.pump();
  pump.pump();
  pump.pump();
  assert.equal(pump.skipped, 1);
  assert.equal(failures.length, 3);
  assert.equal(abandons.length, 1);
  assert.equal(abandons[0].reason, 'transfer-refused');
  assert.equal(abandons[0].failures, 3);
  pump.pump();
  assert.equal(pump.skipped, 1, 'pas de réessai une fois abandonnée');
  assert.equal(failures.length, 3);

  let attempt = 0;
  const log: number[] = [];
  const transient = scriptedJob({ rows: 1, bytesPerRow: 4 }, (row) => {
    attempt++;
    if (attempt <= 2) throw new Error('TRANSIENT');
    log.push(row);
  });
  const second = buildPump([transient], 4);
  second.pump.pump();
  second.pump.pump();
  second.pump.pump();
  assert.equal(second.pump.uploaded, 1);
  assert.equal(second.pump.skipped, 0);
  assert.deepEqual(log, [0]);
});

test('une texture entamée n’est jamais interrompue au milieu d’une tranche, mais peut être reléguée entre deux tranches', () => {
  const logX: number[] = [];
  const jobX = scriptedJob({ layer: 1, rows: 3, bytesPerRow: 4 }, (row) => logX.push(row));
  const jobY = scriptedJob({ layer: 2, rows: 1, bytesPerRow: 4 }, () => {});
  let relegate = false;
  const order = (jobs: TextureJob[]) => {
    if (!relegate) return;
    const index = jobs.findIndex((entry) => entry.slot === 2);
    if (index > 0) jobs.unshift(jobs.splice(index, 1)[0]);
  };
  const { pump } = buildPump([jobX, jobY], 4, order);

  pump.pump(); // jobX takes the only slot this image; one whole row, not a partial one.
  assert.equal(jobX.nextRow, 1);

  relegate = true;
  pump.pump(); // jobY jumps ahead and finishes; jobX is relegated, its progress untouched.
  assert.equal(pump.uploaded, 1);
  assert.equal(jobX.nextRow, 1);

  relegate = false;
  pump.pump(); // jobX resumes exactly where it paused, not from the start.
  assert.equal(jobX.nextRow, 2);
  pump.pump();
  assert.equal(jobX.nextRow, 3);

  assert.equal(pump.uploaded, 2);
  assert.equal(pump.skipped, 0);
  assert.deepEqual(logX, [0, 1, 2]);
});

test('un travail de niveau progressif (stage 0) appelle onLevel, jamais onColorReady ni de régénération de mips', () => {
  const job = scriptedJob({ rows: 1, bytesPerRow: 4 }, () => {});
  job.stage = 0;
  job.level = 3;
  const { pump, submits, colorReady, levels } = buildPump([job], 4);
  pump.pump();
  assert.deepEqual(levels, [[1, 3]]);
  assert.equal(colorReady.length, 0);
  assert.equal(submits.length, 0, 'aucune régénération de mips pour un niveau progressif seul');
  assert.equal(pump.uploaded, 0);
  assert.equal(pump.levels, 1);
});
