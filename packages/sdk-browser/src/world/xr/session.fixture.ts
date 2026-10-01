import type { XrFrame, XrSession, XrSpace, XrTransform } from './platform.ts';

/** Minimal WebXR API emulator: browser frame callbacks only run when the test supplies a frame. */
export class XrSessionEmulator extends EventTarget {
  inputSources: XrSession['inputSources'] = [];
  visibilityState = 'visible';
  frameRate = 90;
  renderState = {};
  callbacks = new Map<number, (time: number, frame: XrFrame) => void>();
  ended = 0;
  next = 0;
  space = new EventTarget() as XrSpace;
  requestReferenceSpace = async () => this.space;
  requestAnimationFrame(callback: (time: number, frame: XrFrame) => void) {
    this.callbacks.set(++this.next, callback);
    return this.next;
  }
  cancelAnimationFrame(id: number) {
    this.callbacks.delete(id);
  }
  updateRenderState(state: object) {
    Object.assign(this.renderState, state);
  }
  async end() {
    this.ended++;
    this.dispatchEvent(new Event('end'));
  }
  tick(frame: XrFrame) {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback(1000 / this.frameRate, frame));
  }
}
export const transform = (x: number): XrTransform => ({
  position: { x, y: 1, z: 2 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
  matrix: new Float32Array(16),
  get inverse() {
    return this;
  },
});
export function xrFrame(session: XrSession, tracked = true): XrFrame {
  return {
    session,
    getViewerPose: () =>
      tracked
        ? {
            transform: transform(0),
            views: [
              { eye: 'left', projectionMatrix: new Float32Array(16), transform: transform(-0.03) },
              { eye: 'right', projectionMatrix: new Float32Array(16), transform: transform(0.03) },
            ],
          }
        : null,
    getPose: () => (tracked ? { transform: transform(3) } : null),
    getJointPose: () => (tracked ? { transform: transform(4), radius: 0.01 } : null),
  };
}
