import type { createWorldFrames } from './worldFrames.ts';
import type { createWorldRuntime } from './worldRuntime.ts';

/** The world loop remains one loop regardless of how many cameras the frame draws. */
export function worldLoopMethods(
  frames: ReturnType<typeof createWorldFrames>,
  runtime: ReturnType<typeof createWorldRuntime>,
  canvas: HTMLCanvasElement,
  ahead: () => void,
  live: () => ReturnType<typeof createWorldRuntime>['explorer'],
) {
  const invalidate = runtime.invalidate;
  return {
    /** Runs a function after every drawn frame, with its time and metrics; returns its remover. */
    onFrame: frames.add,
    /** Runs a function ahead of every drawn frame, with `{ delta, time }`; returns its remover.
     * A frame runs: the camera's controller (unless `controls.autoUpdate` is false or the host
     * leads, `render()`), the clips, the physics, these hooks in their order, the draw, then the
     * `onFrame` hooks. What a hook places — a body on the camera, a cockpit — is drawn in this
     * very frame, never one late. A hook calling `invalidate()` keeps frames coming. */
    beforeFrame: frames.before,
    /** Another name for `onFrame`. */ loop: frames.add,
    /** Asks for a new frame after a change the world could not see. */ invalidate,
    /** Draws one frame now, whoever leads the loop: clips and physics step with it. */ render() {
      if (live()) runtime.render(ahead);
    },
    /** Tells the world the canvas changed size; unset, it reads the canvas's own size.
     *  @param width - New width, CSS pixels. @param height - New height, CSS pixels. */
    resize(width = canvas.clientWidth, height = canvas.clientHeight) {
      live()?.resize(Math.floor(width), Math.floor(height));
      invalidate();
    },
  };
}
