import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts';

/** What a live video texture needs of its element: a frame clock, or its play state. */
type VideoClock = Pick<HTMLVideoElement, 'paused' | 'ended' | 'addEventListener'> & {
  requestVideoFrameCallback?: HTMLVideoElement['requestVideoFrameCallback'];
};

/**
 * Makes a video texture LIVE (#362): each new frame the video presents moves the texture's
 * picture (`needsUpdate`), which the materials that wear it hear — their entry repainted in place,
 * the frame copied into the texture the session already holds, no session reopened. The frame
 * clock is the video's own (`requestVideoFrameCallback`); without it, one copy per display frame
 * while the video plays, resumed by `play`. A paused or ended video asks for nothing, so a still
 * scene does no work. The loop holds the texture weakly: a texture the page let go stops it.
 */
export function followVideoFrames(
  texture: Texture,
  video: VideoClock,
  nextFrame: (callback: () => void) => unknown = (callback) => requestAnimationFrame(callback),
) {
  const held = new WeakRef(texture);
  let waiting = false;
  const frame = () => {
    waiting = false;
    const live = held.deref();
    if (!live) return;
    live.needsUpdate = true;
    watch();
  };
  const watch = () => {
    if (waiting) return;
    if (video.requestVideoFrameCallback) {
      waiting = true;
      video.requestVideoFrameCallback(frame);
    } else if (!video.paused && !video.ended) {
      waiting = true;
      nextFrame(frame);
    }
  };
  video.addEventListener('play', watch);
  watch();
}
