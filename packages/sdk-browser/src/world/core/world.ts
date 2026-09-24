import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { cameraSceneLink } from './worldLink.ts';
import type { ToneMapping } from '../../../../sdk-core/src/world/constants/index.ts';
import { resolveWorldTarget, type WorldTarget } from './worldTarget.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';
import { holdWorldDevice } from './worldDevice.ts';
import { createWorldFrames, type BeforeFrameInfo, type FrameInfo } from './worldFrames.ts';
import { createWorldRuntime } from './worldRuntime.ts';
import { Scene, type LoadOptions } from './scene.ts';
import { worldModelLoader } from './worldLoader.ts';
import { worldRaycast, type CanvasPoint, type RaycastOptions } from './worldRaycast.ts';
import type { Ray } from '../../../../sdk-core/src/world/math/volumes.ts';
import { awaitViewPages, registerWorld } from './worldSession.ts';
import { sessionOptions, type WorldOptions } from './worldOptions.ts';
import { worldBudget, worldControlsHandle, worldDiagnostic, type Pools } from './worldHandles.ts';
import { worldTelemetry } from './worldTelemetry.ts';
import { createWorldPhysics } from '../../physics/worldPhysics.ts';

/** Creates a world: the scene, camera, renderer and loop of one view, drawn once it knows how.
 * @param target - The canvas to draw into, an element to draw inside, or the ID of either.
 * @param options - How the world draws and listens; saying nothing is the normal case.
 * @example const world = createWorld('viewer', { controls: 'orbit' });
 * await world.scene.load('/cache/city/manifest.json'); */
export function createWorld(target: WorldTarget, options: WorldOptions = {}) {
  const canvas = resolveWorldTarget(target);
  const frames = createWorldFrames();
  const pools: Pools = {};
  let camera = new Camera('perspective'),
    toneMapping: ToneMapping = 'aces',
    exposure = 1,
    pixelError: number | undefined,
    bounce = false,
    animating = false,
    disposed = false;
  // A lost device is asked for again, and the session reopened on it.
  const device = holdWorldDevice(canvas, options.renderer, () => runtime.renew());
  const ready = device.ready;
  ready.catch(() => {});
  const scene = new Scene(worldModelLoader(ready, options.signal, () => device.renderer));
  const invalidate = () => runtime.invalidate();
  const diagnostic = worldDiagnostic(() => runtime.explorer);
  const runtime = createWorldRuntime({
    canvas,
    ready: () => device.pending,
    scene,
    camera: () => camera,
    options: () =>
      sessionOptions(options, {
        gpuDevice: device.gpuDevice, // the world's one device: a session never asks another
        bounce,
        geometryPoolBytes: pools.geometryPool,
        texturePoolBytes: pools.texturePool,
        pixelError,
        clearColor: scene.background?.getHex(), // read at opening; a change is written in place
        currentClearColor: () => scene.background?.getHex(),
        beforeFrame: () => {
          animating = frames.step(controls, scene, physics.frame);
          runtime.beforeFrame();
        },
        onFrame: (metrics) => {
          frames.dispatch(metrics);
          // A clip still playing asks for the next frame; the last one lets the loop pause.
          if (animating) invalidate();
        },
      }),
    opened(explorer) {
      device.renderer = explorer.backend === 'webgpu-page-raster' ? 'webgpu' : 'webgl2';
      diagnostic.apply(explorer);
    },
    frame: frames.dispatch,
    drawn: () => frames.last !== null,
    display: () => ({ exposure, toneMapping }),
    diagnostic,
  });
  const physics = createWorldPhysics(runtime, scene, () => camera, options.physics);
  /** The camera outside the scene still redraws when it moves. */
  const cameraLink = cameraSceneLink(invalidate);
  const adopt = (next: Camera) => {
    if (!next._link) next._link = cameraLink;
    return next;
  };
  adopt(camera);
  const controls = worldControlsHandle(
    options.controls ?? 'none',
    () => camera,
    canvas,
    invalidate,
  );
  const live = () => {
    if (disposed) throw new Error('World disposed');
    return runtime.explorer;
  };
  const world = {
    /** The canvas the world draws into. */ canvas,
    /** A promise that settles once the world knows how it will draw. */ ready,
    /** The scene: everything added to it is drawn. */ scene,
    /** The mouse and keyboard controller that moves the camera. */ controls,
    /** `'webgpu'` or `'webgl2'`: how the world draws; `null` before `ready`. */ get renderer() {
      return device.renderer;
    },
    /** The camera the image is seen through; set another to switch. */ get camera() {
      return camera;
    },
    set camera(next: Camera) {
      camera = adopt(next);
      controls.follow();
      invalidate();
    },
    /** The curve that brings scene radiance into the display range; ACES by default. */
    get toneMapping() {
      return toneMapping;
    },
    set toneMapping(curve: ToneMapping) {
      toneMapping = curve;
      runtime.displayChanged();
    },
    /** Scene exposure, the multiplier the lighting applies before presentation. */
    get exposure() {
      return exposure;
    },
    set exposure(value: number) {
      exposure = value;
      runtime.displayChanged();
    },
    /** The DAG cut's screen error, in pixels. */
    get pixelError() {
      return pixelError ?? 0;
    },
    set pixelError(value: number) {
      pixelError = value;
      live()?.setPixelError(value);
      invalidate();
    },
    /** Light bounced off the surfaces, traced against the resident proxy; off by default. A
     *  change is applied in place on a path that carries it, and taken by the next opening on
     *  one that does not. */
    get bounce() {
      return bounce;
    },
    set bounce(on: boolean) {
      if (on === bounce) return;
      bounce = on;
      const session = runtime.explorer;
      if (session && !session.setBounce(on)) runtime.renew();
      invalidate();
    },
    /** Bodies, gravity and time of the physics (Jolt, in a worker). */
    physics: physics.handle,
    /** The world's memory pools, read and set in bytes, and the physics envelopes. */
    budget: worldBudget(pools, runtime, frames, () => device.renderer, physics.budget),
    diagnostic: diagnostic.handle,
    /** The nearest object under a canvas point (CSS pixels) or along a world ray, or `null`:
     *  the node the page added, the world point and normal hit, the distance (`worldRaycast`). */
    raycast: (at: CanvasPoint | Ray, options?: RaycastOptions) =>
      worldRaycast(scene, camera, canvas, at, options),
    /** Runs a function after every drawn frame, with its time and metrics; returns its remover. */
    onFrame: frames.add,
    /** Runs a function ahead of every drawn frame, with `{ delta, time }`; returns its remover.
     * A frame of the world's loop runs: the controller steps the camera (unless
     * `controls.autoUpdate` is false), clips advance, these hooks in the order they were added,
     * the scene is written and drawn, then the `onFrame` hooks. What a hook places — a body on
     * the camera, a cockpit — is drawn in this very frame, never one late. A host-led `render()`
     * runs them too but steps no controller. A hook calling `invalidate()` keeps frames coming. */
    beforeFrame: frames.before,
    /** Another name for `onFrame`. */ loop: frames.add,
    /** Asks for a new frame after a change the world could not see. */ invalidate,
    /** Draws one frame now, whoever leads the loop. */
    render() {
      if (live()) frames.prepare(frames.advance());
      runtime.render();
    },
    /** Tells the world the canvas changed size; unset, it reads the canvas's own size.
     *  @param width - New width, CSS pixels. @param height - New height, CSS pixels. */
    resize(width = canvas.clientWidth, height = canvas.clientHeight) {
      live()?.resize(Math.floor(width), Math.floor(height));
      invalidate();
    },
    ...worldTelemetry(live),
    /** Resolves once the pages the current view reads are resident (`awaitViewPages`). */
    awaitPages: () => awaitViewPages(runtime, live),
    /** Stops the world and gives back all it took: GPU memory, loop, controls. */ dispose() {
      if (disposed) return;
      disposed = true;
      controls.dispose();
      physics.dispose();
      runtime.dispose();
      diagnostic.notices.close();
      frames.clear();
      device.dispose();
    },
  };
  registerWorld(world, { session: () => runtime.explorer, last: () => frames.last });
  return world;
}

/** What `createWorld` returns: one view. */ export type World = ReturnType<typeof createWorld>;
export type { FrameInfo, BeforeFrameInfo, WorldTarget, WorldRenderer, LoadOptions, WorldOptions };
