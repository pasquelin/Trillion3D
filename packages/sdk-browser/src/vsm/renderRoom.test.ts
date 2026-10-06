// The shadow raster's lists grow only within the room the device ledger admits
// (`vsmChunkRowsWithin`): fewer rows a chunk — the same pages in more passes — or, when not even
// one row's lists fit, no raster this frame; never an allocation the budget refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { installGpuDeviceLedger } from '../gpu/core/deviceLedger.ts';
import { createVsmResources } from './resources.ts';
import { encodeVsmRender, vsmChunkRowsWithin } from './renderPass.ts';
import { recordingRaster } from './rowPageBound.fixture.ts';

const BINDING = 1 << 27;
const sizes = (rows: number) => ({ pairs: rows * 4096, cmds: rows * 1024 });

/** A device whose ledger admits `room` bytes beside what it holds. */
function roomy(room: number) {
  const limits = { maxStorageBufferBindingSize: BINDING, maxBufferSize: BINDING };
  const fake = fakeDevice({ limits });
  const box = { limit: 1e12 };
  const ledger = installGpuDeviceLedger(fake.device, { limit: () => box.limit });
  return { fake, ledger, box, admit: (bytes = room) => (box.limit = ledger.bytes + bytes) };
}

test('the rows a chunk takes halve until their lists grow within the room', () => {
  const r = roomy(0);
  const rows = (room: number, buffers = {}) => {
    r.admit(room);
    return vsmChunkRowsWithin(r.fake.device, buffers, 64, sizes).rows;
  };
  assert.equal(rows(1e12), 64);
  // 64 rows ask 256 KiB + 64 KiB; 32 rows half that.
  assert.equal(rows(256 * 1024 + 64 * 1024), 64);
  assert.equal(rows(256 * 1024 + 64 * 1024 - 1), 32);
  assert.equal(rows(4096 + 1024), 1);
  assert.equal(rows(4096 + 1024 - 1), 0, 'not one row');
  // A list already as large asks nothing; the one it replaces is freed first.
  r.box.limit = 1e12;
  const held = { pairs: r.fake.device.createBuffer({ size: 256 * 1024, usage: 0 }) };
  const small = { pairs: r.fake.device.createBuffer({ size: 128 * 1024, usage: 0 }) };
  assert.equal(rows(64 * 1024, held), 64);
  assert.equal(rows(128 * 1024 + 64 * 1024, small), 64);
  assert.equal(rows(128 * 1024 + 64 * 1024 - 1, small), 32);
});

/** The raster of `rowCount` rows under one sun, encoded on a recording device. */
function raster(r: ReturnType<typeof roomy>, rowCount: number) {
  const { device } = r.fake;
  const res = createVsmResources(device, { fullMapCapacity: 127, poolPages: 256 });
  const { encoder, scene, lights } = recordingRaster(device, rowCount);
  return (rows = rowCount) =>
    encodeVsmRender(encoder, res, { device, lights }, { ...scene, rowCount: rows });
}

test('a raster whose lists the room cannot hold whole draws in smaller chunks, or waits', () => {
  const r = roomy(0);
  const draw = raster(r, 1);
  assert.equal(draw(1)!.roomLimited, false, 'one row: its lists made');
  // 4096 rows ask chunks of every row (2^21 pairs over 256 pages): 16 MiB of pairs.
  r.admit(4 * 1024 * 1024);
  const limited = draw(4096)!;
  assert.equal(limited.roomLimited, true);
  assert.ok(limited.chunkRows < 4096, `${limited.chunkRows} rows a chunk`);
  assert.ok(limited.chunks * limited.chunkRows >= 4096, 'every row drawn');
  assert.equal(r.ledger.refusal, undefined);
  r.admit(0);
  const none = draw(1 << 16)!;
  assert.deepEqual([none.chunks, none.roomLimited], [0, true], 'no room: no raster');
  assert.equal(r.ledger.refusal, undefined);
  r.box.limit = 1e12;
  const free = draw(4096)!;
  assert.deepEqual([free.chunkRows, free.roomLimited], [4096, false], 'with room, as asked');
});
