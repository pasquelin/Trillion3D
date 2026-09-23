import assert from 'node:assert/strict';
import test from 'node:test';
import { playPickedVideo } from '../site/examples/kit/media.ts';
import { perFrame } from '../site/examples/kit/perFrame.ts';
import { pointerOnPlane } from '../site/examples/kit/pointer.ts';
import { seeded } from '../site/examples/kit/random.ts';

test('the pointer meets the ground under the ray through it, and never behind the eye', () => {
  const box = { left: 0, top: 0, width: 200, height: 100 };
  // Looking straight down from 10 m: the centre of the view is the point below the eye.
  const down = { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  const world = {
    canvas: { getBoundingClientRect: () => box },
    camera: { fov: 90, position: { x: 3, y: 10, z: -2 }, quaternion: down },
  };
  const [x, z] = pointerOnPlane(world, { clientX: 100, clientY: 50 }) ?? [];
  assert.ok(Math.abs(x - 3) < 1e-9 && Math.abs(z + 2) < 1e-9);
  // The plane at the eye's height, or one looked away from, is never met.
  assert.equal(pointerOnPlane(world, { clientX: 100, clientY: 50 }, 10), null);
  assert.equal(pointerOnPlane(world, { clientX: 100, clientY: 50 }, 12), null);
});

test('a picked video file replaces the stream, and the file played before is released', (t) => {
  const released: string[] = [];
  t.mock.method(URL, 'revokeObjectURL', (address: string) => released.push(address));
  const picker = new EventTarget() as EventTarget & { files: File[] | null };
  const video = { srcObject: {} as unknown, src: '', paused: false, play: async () => {} };
  const names: string[] = [];
  playPickedVideo(picker as never, video as never, (name) => names.push(name));
  for (const name of ['first.mp4', 'second.mp4']) {
    picker.files = [new File([name], name)];
    picker.dispatchEvent(new Event('change'));
  }
  assert.equal(video.srcObject, null);
  assert.deepEqual(names, ['first.mp4', 'second.mp4']);
  assert.equal(released.length, 1);
  assert.notEqual(released[0], video.src);
});

test('a drag runs its change once a frame, and the end of the drag at once', () => {
  const frames: (() => void)[] = [];
  let runs = 0;
  const run = perFrame(
    () => runs++,
    (next) => frames.push(next),
  );
  for (let move = 0; move < 5; move++) run();
  assert.equal(runs, 0);
  frames.shift()?.();
  assert.equal(runs, 1);
  run();
  run(true);
  assert.equal(runs, 2);
  // The frame queued before the drag ended has nothing left to run.
  frames.shift()?.();
  assert.equal(runs, 2);
});

test('a seeded sequence repeats itself and stays in [0, 1)', () => {
  const first = seeded(7),
    again = seeded(7);
  const drawn = Array.from({ length: 1000 }, () => first());
  assert.deepEqual(
    drawn,
    Array.from({ length: 1000 }, () => again()),
  );
  assert.ok(drawn.every((value) => value >= 0 && value < 1));
  assert.notEqual(seeded(8)(), drawn[0]);
});
