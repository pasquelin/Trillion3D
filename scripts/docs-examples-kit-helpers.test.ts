import assert from 'node:assert/strict';
import test from 'node:test';
import { Camera } from '../packages/sdk-core/src/world/camera/camera.ts';
import { playPickedVideo } from '../site/examples/kit/media.ts';
import { perFrame } from '../site/examples/kit/perFrame.ts';
import { pointerOnPlane } from '../site/examples/kit/pointer.ts';
import { mulberry32, seeded } from '../site/examples/kit/random.ts';

test('the pointer meets the ground under the ray through it, and never behind the eye', () => {
  const box = { left: 0, top: 0, width: 200, height: 100 };
  // Looking straight down from 10 m: the centre of the view is the point below the eye.
  const camera = new Camera('perspective');
  camera.fov = 90;
  camera.position.set(3, 10, -2);
  camera.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
  const world = { canvas: { getBoundingClientRect: () => box }, camera };
  const [x, z] = pointerOnPlane(world, { clientX: 100, clientY: 50 }) ?? [NaN, NaN];
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

test('mulberry32 draws the sequence the scenes, the bench and the campaigns were laid out with', () => {
  // The seed of the screen-error campaign, above 2^31: its signed and unsigned states agree.
  const draw = mulberry32(0x9e3779b9);
  assert.deepEqual(
    [draw(), draw(), draw()],
    [0.3588899802416563, 0.10590326134115458, 0.675290479324758],
  );
});
