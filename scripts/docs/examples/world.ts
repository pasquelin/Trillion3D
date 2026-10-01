import { Camera, Scene, Vector3 } from '../../../packages/sdk/browser.ts';

type Frame = (frame: { delta: number }) => void;

/** A page's scene and lifecycle without a renderer; tests supply only their own IO. */
export function fakeWorld() {
  const frames = new Set<Frame>(),
    beforeFrames = new Set<() => void>();
  const state = { invalidations: 0, disposals: 0 };
  const world = {
    scene: new Scene(() => Promise.reject(new Error('the page loads no model'))),
    camera: new Camera('perspective'),
    controls: {
      target: new Vector3(),
      minDistance: 0,
      maxDistance: Infinity,
      maxPolarAngle: Math.PI,
    },
    invalidate() {
      state.invalidations++;
    },
    dispose() {
      state.disposals++;
    },
    onFrame(hook: Frame) {
      frames.add(hook);
      return () => frames.delete(hook);
    },
    beforeFrame(hook: () => void) {
      beforeFrames.add(hook);
      return () => beforeFrames.delete(hook);
    },
  };
  return {
    world,
    state,
    frame(frame = { delta: 0 }) {
      for (const hook of beforeFrames) hook();
      for (const hook of frames) hook(frame);
    },
  };
}
