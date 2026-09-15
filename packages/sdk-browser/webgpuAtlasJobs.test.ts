import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { previewLevelJobs, textureJobFor } from './webgpuAtlasJobs.ts';
import { recordingDevice } from './bench/oracles/h3AtlasJobsOracle.ts';

test('les tranches d’une texture couvrent exactement W×H, sans trou ni chevauchement, comme un transfert en un bloc', () => {
  const width = 4,
    height = 3;
  const source = new Uint8Array(width * height * 4);
  for (let i = 0; i < source.length; i++) source[i] = i % 251;
  const map = new THREE.DataTexture(source, width, height);
  const rgba = { data: source, width, height };

  const block = recordingDevice();
  const blockJob = textureJobFor({
    device: block.device,
    texture: {} as GPUTexture,
    rgba,
    map,
    place: { slot: 1, classIndex: 0, layer: 1 },
    kind: 'color',
    atlas: [width, height],
    errorCode: 'X',
  }).job;
  blockJob.uploadRows(0, blockJob.rows);

  const sliced = recordingDevice();
  const slicedJob = textureJobFor({
    device: sliced.device,
    texture: {} as GPUTexture,
    rgba,
    map,
    place: { slot: 1, classIndex: 0, layer: 1 },
    kind: 'color',
    atlas: [width, height],
    errorCode: 'X',
  }).job;
  for (let row = 0; row < slicedJob.rows; row++) slicedJob.uploadRows(row, 1);

  assert.equal(slicedJob.rows, height);
  assert.equal(slicedJob.bytesPerRow, width * 4);
  assert.equal(slicedJob.bytes, width * height * 4);

  // Contiguous, non-overlapping coverage: every row visited exactly once, in order.
  assert.deepEqual(
    sliced.calls.map((call) => call.origine[1]),
    [0, 1, 2],
  );
  for (const call of sliced.calls) assert.equal(call.hauteur, 1);

  // Same bytes as a single-block transfer, slice by slice.
  const reassembled = new Uint8Array(width * height * 4);
  sliced.calls.forEach((call, index) =>
    reassembled.set(call.octets, index * slicedJob.bytesPerRow),
  );
  assert.deepEqual(reassembled, block.calls[0].octets);
});

// L'atlas couleur est `rgba8unorm-srgb` et le sidecar porte déjà des octets sRGB à alpha droit :
// entre les deux il ne doit rien se passer. Ce test suit un texel connu — la valeur 188, dont le
// linéaire n'est ni 188/255 ni son carré — de la pyramide du sidecar jusqu'à l'octet remis au GPU,
// et vérifie au passage que le niveau `k` part bien dans le niveau de mip `k` de la couche.
test('un niveau progressif part tel quel, octet pour octet, dans le niveau de mip de même rang', () => {
  const { device, calls } = recordingDevice();
  // Source 128×64 : son premier niveau porté est le 1, celui dont aucun côté ne dépasse 64.
  const levels = [64, 32, 16, 8, 4, 2, 1].map((side, index) => {
    const [w, h] = [side, Math.max(1, 64 >> index)];
    return Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : 188));
  });
  const jobs = previewLevelJobs({
    device,
    texture: {} as GPUTexture,
    place: { slot: 3, classIndex: 0, layer: 3 },
    preview: {
      texture: 0,
      image: 0,
      width: 128,
      height: 64,
      sourceKind: 0,
      sourceBufferView: -1,
      sha256: '0'.repeat(64),
      firstLevel: 1,
      levels,
    },
  });
  // Du plus grossier au plus fin : la résidence de la couche avance d'un cran à chaque niveau reçu.
  assert.deepEqual(
    jobs.map((entry) => entry.level),
    [7, 6, 5, 4, 3, 2, 1],
  );
  assert.ok(
    jobs.every((entry) => entry.stage === 0 && entry.pyramid?.first === 1),
    'ce sont des niveaux progressifs, et ils portent la pyramide de leur texture',
  );
  for (const entry of jobs) entry.uploadRows(0, entry.rows);
  assert.deepEqual(
    calls.map((call) => [call.niveau, call.largeur, call.hauteur]),
    [
      [7, 1, 1],
      [6, 2, 1],
      [5, 4, 2],
      [4, 8, 4],
      [3, 16, 8],
      [2, 32, 16],
      [1, 64, 32],
    ],
  );
  // Aucun ré-encodage, aucune conversion : les octets du sidecar sont ceux que le GPU reçoit.
  for (const call of calls)
    assert.ok(
      call.octets.every((byte, i) => byte === (i % 4 === 3 ? 255 : 188)),
      `niveau ${call.niveau} : octet modifié entre le sidecar et le GPU`,
    );
});
