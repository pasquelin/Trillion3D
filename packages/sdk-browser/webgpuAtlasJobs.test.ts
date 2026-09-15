import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { textureJobFor } from './webgpuAtlasJobs.ts';

/** Records each `writeTexture` call: the row it starts at, the rows it covers and the bytes sent. */
function fakeWriteTextureDevice() {
  const calls: Array<{ row: number; height: number; bytes: Uint8Array }> = [];
  const device = {
    queue: {
      writeTexture(
        dest: { origin: [number, number, number] },
        data: ArrayBufferLike,
        _layout: { bytesPerRow: number; rowsPerImage: number },
        size: { width: number; height: number },
      ) {
        calls.push({ row: dest.origin[1], height: size.height, bytes: new Uint8Array(data) });
      },
    },
  };
  return { device: device as unknown as GPUDevice, calls };
}

test('les tranches d’une texture couvrent exactement W×H, sans trou ni chevauchement, comme un transfert en un bloc', () => {
  const width = 4,
    height = 3;
  const source = new Uint8Array(width * height * 4);
  for (let i = 0; i < source.length; i++) source[i] = i % 251;
  const map = new THREE.DataTexture(source, width, height);
  const rgba = { data: source, width, height };

  const block = fakeWriteTextureDevice();
  const blockJob = textureJobFor({
    device: block.device,
    texture: {} as GPUTexture,
    rgba,
    map,
    layer: 1,
    kind: 'color',
    atlas: [width, height],
    errorCode: 'X',
  }).job;
  blockJob.uploadRows(0, blockJob.rows);

  const sliced = fakeWriteTextureDevice();
  const slicedJob = textureJobFor({
    device: sliced.device,
    texture: {} as GPUTexture,
    rgba,
    map,
    layer: 1,
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
    sliced.calls.map((call) => call.row),
    [0, 1, 2],
  );
  for (const call of sliced.calls) assert.equal(call.height, 1);

  // Same bytes as a single-block transfer, slice by slice.
  const reassembled = new Uint8Array(width * height * 4);
  sliced.calls.forEach((call, index) => reassembled.set(call.bytes, index * slicedJob.bytesPerRow));
  assert.deepEqual(reassembled, block.calls[0].bytes);
});
