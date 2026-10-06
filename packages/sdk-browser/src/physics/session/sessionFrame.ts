import type { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';
import { MAX_CATCH_UP_STEPS } from '../../../../sdk-core/src/physics/index.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { resolveCameraWorld } from '../../camera/world.ts';
import type { SessionParts } from './sessionParts.ts';

/** The scene's tree or its bodies changed: they are reconciled, with the joints and vehicles. */
function reconcileBodies(c: SessionParts) {
  c.bodies.reconcile(c.stale, (error) => c.failed(error as EngineError));
  c.joints.reconcile(c.wanted.joints);
  c.vehicles.reconcile(c.wanted.vehicles);
  c.tiles.scan(c.root);
  c.stale.clear();
  c.s.dirty = false;
  c.stats.bodies = c.bodies.count.bodies;
}

/** Everything drawn at the frame's time: the bodies, the wheels, the soft bodies; a frame at the
 *  time the last drew, with nothing new, draws nothing again. */
function drawAtTime(c: SessionParts) {
  const { s, clock } = c,
    { drawn } = clock;
  if (!s.redraw && drawn.step === s.drawnStep && drawn.owed === s.drawnOwed) return;
  const t = c.link.at();
  s.moving = c.poses.apply(c.bodies, t, s.live);
  s.moving = c.vehicles.apply(t, s.live) || s.moving;
  s.moving = c.soft.apply(t, s.live) || s.moving;
  [s.redraw, s.drawnStep, s.drawnOwed] = [false, drawn.step, drawn.owed];
}

/** The frame's time and its physics. */
export function createSessionFrame(c: SessionParts) {
  const { s, clock, link } = c;
  return {
    /** The frame's time, `seconds` after the last (`FrameInfo.delta`), set at its start: all it
     *  draws reads it, the character the controller moves first included (`worldFrames.ts`). */
    time(seconds: number) {
      // Waiting on the worker, the clock leads its newest state by the steps a frame can draw
      // past it at most (`along`): a slower worker shows slow motion, never a growing backlog.
      s.owed += clock.frame(seconds, s.live ? s.reached + MAX_CATCH_UP_STEPS + 1 : Infinity);
    },
    /** The frame's physics: bodies reconciled, everything drawn at its time, the view (`range`),
     *  commands sent, then the steps it owes. Whether a body is still on its way or the worker
     *  steps on (and asks for the next frame). */
    frame(camera: Camera, range: number | null) {
      c.touched.eye = camera;
      if (s.dirty) reconcileBodies(c);
      drawAtTime(c);
      [c.stats.mainMs, s.received] = [s.received, 0];
      const reach = c.view(camera, c.writer, range);
      c.tiles.update(resolveCameraWorld(camera).matrixWorld.elements.slice(12, 15), reach);
      link.flush();
      if (s.ready) c.character.flush();
      // After the frame's commands and keys: the steps they reach while the world is awake; the
      // clock standing still, what was sent runs in place.
      if (s.ready && (s.owed > 0 ? s.live : clock.paused && s.sent)) link.advance(s.owed);
      s.owed = 0;
      // Paused, the time drawn stands still: no frame draws anything new.
      return !clock.paused && (s.moving || s.live);
    },
  };
}
