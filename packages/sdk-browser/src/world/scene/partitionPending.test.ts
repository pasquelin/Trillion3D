import test from 'node:test';
import assert from 'node:assert/strict';
import type { RenderBackend } from '../../backend/types.ts';
import { hostFramingCamera } from '../../host/scene/graphObjects.ts';
import type { PartitionCells } from '../../scene/partition/cells.ts';
import type { createPageStreamer } from '../../streaming/pages.ts';
import { createPartitionFrame } from './partitionFrame.ts';

type Io = Parameters<PartitionCells['frame']>[2];

test('a still camera is drawn again until the cells it asked for within reach are placed', async () => {
  // The interactive session draws on demand: once the camera stops, only `pending` asks for the
  // frames that place the cells read after it (`hostRuntime.ts`, `pendingFrame`).
  let later = true,
    read = () => {};
  const cells = {
    frame(_eye: number[], _reach: number, io: Io) {
      io.request(['near.json'], false);
      io.request(['ahead.json'], true);
      return later;
    },
  } as unknown as PartitionCells;
  const streamer = {
    request: (urls: readonly string[]) =>
      new Promise<void>((resolve) => {
        if (urls[0] === 'near.json') read = resolve;
      }),
  } as unknown as ReturnType<typeof createPageStreamer>;
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    active: () => ({}) as RenderBackend,
    budget: { admits: () => true, spend() {} },
  })!;
  frame();
  let settled = false;
  const pending = frame.pending().then((again) => ((settled = true), again));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, false, 'it waits on the read within reach, never on one ahead');
  read();
  assert.equal(await pending, true, 'the cell read asks for a frame');
  later = false;
  frame();
  read();
  assert.equal(await frame.pending(), false, 'nothing is left to place');
});
