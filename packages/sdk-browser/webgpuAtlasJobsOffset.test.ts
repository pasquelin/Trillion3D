import test from 'node:test';
import assert from 'node:assert/strict';
import { textureJobFor, previewLevelJobs } from './webgpuAtlasJobs.ts';
import {
  bandes,
  pixels,
  recordingDevice,
  referenceWriteRows,
} from './bench/oracles/h3AtlasJobsOracle.ts';
import { graine } from '../sdk-core/bench/socle.mjs';
import type { TexturePreview } from '../sdk-core/index.ts';

// H3-1 : la bande de lignes n'est plus recopiée hors des pixels entiers avant d'être remise à
// l'appareil ; `dataLayout.offset` désigne son premier octet. Ce que le GPU reçoit ne change pas —
// même destination, même niveau de mip, même gabarit de lignes, mêmes octets de texels — et
// l'appareil de banc refait au passage la validation que la spécification impose : assez d'octets à
// partir de `offset`, aucune ligne plus courte que la région. La spécification n'exige un `offset`
// multiple de 4 que pour un format de profondeur ou de gabarit ; les deux atlas sont `rgba8unorm`,
// et l'offset vaut de toute façon `row * width * 4`.

const CAS: Array<[number, number, number]> = [
  [4, 3, 1],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 8],
  [1, 1, 1],
  [7, 5, 2],
  [3, 2, 8],
  [64, 17, 5],
  [129, 33, 7],
];

test('H3-1 : les octets remis au GPU, leur destination et leur gabarit sont ceux d’avant', () => {
  for (const [width, height, bande] of CAS) {
    const octets = pixels(width, height, graine(width + height + bande));
    const attendu = recordingDevice();
    const upload = referenceWriteRows(attendu.device, {} as GPUTexture, 0, 1, octets, width);
    for (const [row, count] of bandes(height, bande)) upload(row, count);

    const obtenu = recordingDevice();
    const { job } = textureJobFor({
      device: obtenu.device,
      texture: {} as GPUTexture,
      rgba: { data: octets, width, height },
      map: {} as never,
      place: { slot: 1, classIndex: 0, layer: 1 },
      kind: 'color',
      atlas: [width, height],
      errorCode: 'H3_SANS_OBJET',
    });
    for (const [row, count] of bandes(height, bande)) job.uploadRows(row, count);

    const quoi = `${width}×${height}, bandes de ${bande}`;
    assert.equal(obtenu.calls.length, attendu.calls.length, `${quoi} : nombre de transferts`);
    obtenu.calls.forEach((call, i) => {
      const ref = attendu.calls[i];
      assert.deepEqual(
        { ...call, octets: undefined },
        { ...ref, octets: undefined },
        `${quoi}, transfert ${i} : destination ou gabarit`,
      );
      assert.equal(call.octets.length, ref.octets.length, `${quoi}, transfert ${i} : longueur`);
      for (let k = 0; k < ref.octets.length; k++)
        assert.ok(
          Object.is(call.octets[k], ref.octets[k]),
          `${quoi}, transfert ${i}, octet ${k} : ${call.octets[k]} ≠ ${ref.octets[k]}`,
        );
    });
  }
});

test('H3-1 : les niveaux progressifs d’un aperçu partent eux aussi octet pour octet', () => {
  const [width, height, firstLevel] = [128, 64, 1];
  const levels: Uint8Array[] = [];
  for (let level = firstLevel; ; level++) {
    const [w, h] = [Math.max(1, width >> level), Math.max(1, height >> level)];
    levels.push(pixels(w, h, graine(level)));
    if (w === 1 && h === 1) break;
  }
  const preview = {
    texture: 0,
    image: 0,
    width,
    height,
    sourceKind: 0,
    sourceBufferView: -1,
    atlas: 0,
    bakedLevels: 0,
    sha256: '0'.repeat(64),
    firstLevel,
    levels,
  } as TexturePreview;

  const attendu = recordingDevice();
  for (let index = levels.length - 1; index >= 0; index--) {
    const level = firstLevel + index;
    const w = Math.max(1, width >> level);
    const h = Math.max(1, height >> level);
    const upload = referenceWriteRows(attendu.device, {} as GPUTexture, level, 3, levels[index], w);
    for (const [row, count] of bandes(h, 3)) upload(row, count);
  }

  const obtenu = recordingDevice();
  const jobs = previewLevelJobs({
    device: obtenu.device,
    texture: {} as GPUTexture,
    place: { slot: 3, classIndex: 0, layer: 3 },
    preview,
    kind: 'color',
    pyramid: { first: firstLevel, last: firstLevel + levels.length - 1 },
  });
  for (const job of jobs)
    for (const [row, count] of bandes(job.rows, 3)) job.uploadRows(row, count);

  assert.equal(obtenu.calls.length, attendu.calls.length);
  obtenu.calls.forEach((call, i) =>
    assert.deepEqual(call, attendu.calls[i], `niveau progressif, transfert ${i}`),
  );
});
