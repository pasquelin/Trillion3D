// #362: a video texture is live by itself — each frame the video presents moves its picture —,
// and a paused video asks for nothing: a still scene does no work.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';
import { followVideoFrames } from './liveVideo.ts';
import { pictureSize } from '../../texture/pictureSize.ts';

/** A video element stand-in: its frame callbacks and `play` listeners, run by the test. */
function video(options: { clock: boolean; paused: boolean }) {
  const frames: (() => void)[] = [],
    plays: (() => void)[] = [];
  const element = {
    paused: options.paused,
    ended: false,
    addEventListener: (_type: string, listener: () => void) => void plays.push(listener),
    requestVideoFrameCallback: options.clock
      ? (callback: () => void) => frames.push(callback)
      : undefined,
  };
  /** Presents one frame: the callbacks registered so far, once each. */
  const present = () => frames.splice(0).forEach((callback) => callback());
  return { element, frames, plays, present };
}

test('each frame the video presents moves the picture, one callback at a time', () => {
  const map = new Texture(null);
  const { element, frames, present } = video({ clock: true, paused: false });
  followVideoFrames(map, element as never);
  for (let frame = 1; frame <= 120; frame++) {
    const before = map.version;
    present();
    assert.ok(map.version > before, `frame ${frame}: the picture moved`);
    assert.equal(frames.length, 1, 'one callback waits for the next frame');
  }
});

test('without a frame clock, a paused video asks for nothing until it plays', () => {
  const map = new Texture(null);
  const { element, plays } = video({ clock: false, paused: true });
  const displayed: (() => void)[] = [];
  followVideoFrames(map, element as never, (callback) => displayed.push(callback));
  assert.equal(displayed.length, 0, 'paused: nothing asked');
  element.paused = false;
  plays.forEach((play) => play());
  plays.forEach((play) => play());
  assert.equal(displayed.length, 1, 'playing: one display frame asked, once however told');
  displayed.shift()!();
  const first = map.version;
  assert.ok(first > 0, 'the frame moved the picture');
  element.paused = true;
  displayed.shift()!();
  assert.ok(map.version > first, 'the last frame copied');
  assert.equal(displayed.length, 0, 'paused again: the loop stops');
});

test('a video is as large as its frames, not as its element box', () => {
  assert.deepEqual(
    pictureSize({ videoWidth: 640, videoHeight: 360, width: 0, height: 0 }),
    [640, 360],
  );
  assert.deepEqual(pictureSize({ width: 16, height: 9 }), [16, 9]);
  assert.deepEqual(pictureSize({ videoWidth: 0, videoHeight: 0 }), [1, 1], 'no frame yet');
  assert.deepEqual(pictureSize(null), [1, 1]);
});
