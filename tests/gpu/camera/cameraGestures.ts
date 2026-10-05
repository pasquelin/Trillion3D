// The gestures the camera proofs play on a canvas of the page's document, as the bench's scenario
// player dispatches them (`bench/dawn/scenario.ts`): the page's own event classes, pointers and
// wheel on the canvas, keys on the document then the window. The player itself presses only the
// primary button, and its wheel says no delta mode; these press any button and wheel in pixels, as
// a mouse does. And the camera probe: one manual world whose controller is swapped, the image of
// the pose a gesture starts from kept, what differs once the gesture is undone counted.
import { pixelDifference } from '../../../bench/dawn/capture.ts';
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/world/session/explorer.ts';
import { measurementSdk, proofCanvas } from '../kit/renderHarness.ts';
import { settle } from '../world/proofWorld.ts';

/** One pointer event of the mouse at `(x, y)` CSS pixels of the canvas, `buttons` held. */
function pointer(canvas: EventTarget, type: string, x: number, y: number, buttons = 0, button = 0) {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 7,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: x,
      clientY: y,
      buttons,
      button,
    }),
  );
}

/** A straight drag of `(dx, dy)` pixels from `(x, y)` in four moves, on `button` (0 primary,
 *  2 secondary). */
export function drag(
  canvas: EventTarget,
  [x, y]: [number, number],
  dx: number,
  dy: number,
  button = 0,
) {
  const buttons = button === 2 ? 2 : 1;
  pointer(canvas, 'pointerdown', x, y, buttons, button);
  for (let step = 1; step <= 4; step++)
    pointer(canvas, 'pointermove', x + (dx * step) / 4, y + (dy * step) / 4, buttons, button);
  pointer(canvas, 'pointerup', x + dx, y + dy, 0, button);
}

/** A wheel turn of `deltaY` pixels over `(x, y)`. */
export function wheel(canvas: EventTarget, [x, y]: [number, number], deltaY: number) {
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode: 0, clientX: x, clientY: y }));
}

/** A key by its `code` (`KeyW`), to the document and on to the window, as a browser sends it. */
export function key(type: 'keydown' | 'keyup', code: string) {
  const init = { code, key: code.replace(/^Key/, '').toLowerCase() };
  document.dispatchEvent(new KeyboardEvent(type, init));
  window.dispatchEvent(new KeyboardEvent(type, init));
}

/** A controller as the proof drives it: its pivot when it has one, its change events, its step. */
type Controls = {
  target?: { x: number; y: number; z: number };
  minDistance?: number;
  maxDistance?: number;
  addEventListener(type: 'change', listener: () => void): void;
  update(delta?: number): boolean;
  dispose(): void;
};

/**
 * One manual world on `manifestUrl`, 240 × 160 at a ratio of one, whose controller is swapped per
 * gesture: `begin(kind)` mounts it and keeps the image of the pose it starts from, `step(seconds)`
 * integrates it as a host's frame loop would, `end()` counts the pixels that differ from that image.
 */
export async function openCameraProbe(manifestUrl: string) {
  const { openMeasuredWorld, webgpuPagesBackend } = await measurementSdk();
  const canvas = proofCanvas('viewer');
  const world: MeasuredWorld = await openMeasuredWorld(canvas, {
    manifestUrl,
    scope: 'full',
    backends: [webgpuPagesBackend],
    width: 240,
    height: 160,
    pixelRatio: 1,
    temporalAntialiasing: false,
  });
  let controls: Controls | undefined,
    baseline = new Uint8Array(),
    changes = 0;
  /** Eye, orientation and pivot as they stand, so a caller can tell the pose moved. */
  const pose = () => {
    const { position, quaternion } = world.camera;
    const target = controls?.target;
    return [
      ...[position.x, position.y, position.z],
      ...[quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      ...(target ? [target.x, target.y, target.z] : []),
    ].map((value) => Number(value.toFixed(9)) + 0); // `+ 0` so a negative zero reads as zero.
  };
  const draw = async () => {
    await settle(world);
    return new Uint8Array(world.capture());
  };
  return {
    world,
    canvas,
    pose,
    async begin(
      kind:
        | 'controls'
        | 'trackballControls'
        | 'panZoomControls'
        | 'flyControls'
        | 'firstPersonControls',
    ) {
      controls?.dispose();
      controls = (world[kind] as () => Controls)();
      if (controls.target) {
        controls.minDistance = 0.2;
        controls.maxDistance = 40;
        controls.update();
      }
      changes = 0;
      controls.addEventListener('change', () => changes++);
      baseline = await draw();
      return pose();
    },
    step(seconds: number) {
      controls?.update(seconds);
      return pose();
    },
    async end() {
      const image = await draw();
      const differences = pixelDifference(image, baseline).pixels;
      return { differences, pose: pose(), changes, bytes: image.length };
    },
    dispose() {
      controls?.dispose();
      world.dispose();
      canvas.remove();
    },
  };
}
