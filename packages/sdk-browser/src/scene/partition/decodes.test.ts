import test from 'node:test';
import assert from 'node:assert/strict';
import { cellUrl, decodeHere, io, noBudget, settled, world } from './cells.fixture.ts';

test('a frame says when a cell within reach is left for a later one, read or decoded', async () => {
  const { cells, bytes } = world();
  const { port, held } = io(bytes);
  await settled(cells, [0, 0, 0], 100, port, noBudget); // the pages of the index it reaches
  const unread = cells.frame([0, 0, 0], 100, port, noBudget);
  held.add(cellUrl('near.json'));
  const decoding = cells.frame([0, 0, 0], 100, port, noBudget);
  assert.equal(cells.stats().held, 0, 'nothing is placed before its decode lands');
  await Promise.all(cells.decodes());
  assert.deepEqual(
    [unread, decoding, cells.frame([0, 0, 0], 100, port, noBudget)],
    [true, true, false],
  );
});

test('a cell file is never parsed by the frame: its bytes go to the decode, its rows are placed', async () => {
  const { cells, bytes } = world();
  const { port, held } = io(bytes);
  const decoded: Uint8Array[] = [];
  // The decode runs later, as the pool answers: whatever it parses is not the frame's.
  port.decode = (read) => (decoded.push(read), Promise.resolve().then(() => decodeHere(read)));
  await settled(cells, [0, 0, 0], 100, port, noBudget);
  held.add(cellUrl('near.json'));
  const parse = JSON.parse;
  let parsed = 0;
  const frame = () => {
    JSON.parse = (...args: Parameters<typeof parse>) => (parsed++, parse(...args));
    try {
      cells.frame([0, 0, 0], 100, port, noBudget);
    } finally {
      JSON.parse = parse;
    }
  };
  frame();
  await Promise.all(cells.decodes());
  frame();
  assert.deepEqual([parsed, decoded.length, cells.stats().held], [0, 1, 1]);
  // A file the decode refused is thrown by the frame that reads it, as before.
  const refused = world();
  const other = io(refused.bytes);
  other.held.add(cellUrl('far.json'));
  other.port.decode = () => Promise.reject(new Error('INVALID_SCENE_TABLES'));
  await assert.rejects(
    settled(refused.cells, [5000, 0, 0], 100, other.port, noBudget),
    /INVALID_SCENE_TABLES/,
  );
});
