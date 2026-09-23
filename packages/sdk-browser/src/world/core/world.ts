import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import type { SceneLink } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { ToneMapping } from '../../../../sdk-core/src/world/constants/index.ts';
import { resolveWorldTarget, type WorldTarget } from './worldTarget.ts';
import { probeWorldRenderer, type WorldRenderer } from '../capability/worldReady.ts';
import { createWorldFrames, type FrameInfo } from './worldFrames.ts';
import { createWorldRuntime } from './worldRuntime.ts';
import { Scene, type LoadOptions } from './scene.ts';
import { loadModel } from './loadedModel.ts';
import { loadModelOfAnyFormat } from '../loader/modelFormat.ts';
import { awaitViewPages, registerWorld } from './worldSession.ts';
import { advanceMixers } from '../../../../sdk-core/src/world/animation/index.ts';
import { sessionOptions, type WorldOptions } from './worldOptions.ts';
import { worldBudget, worldControlsHandle, worldDiagnostic, type Pools } from './worldHandles.ts';

/** Creates a world: the scene, camera, renderer and loop of one view, drawn once it knows how.
 * @param target - The canvas to draw into, an element to draw inside, or the ID of either.
 * @param options - How the world draws and listens; saying nothing is the normal case.
 * @example const world = createWorld('viewer', { controls: 'orbit' });
 * await world.scene.load('/cache/city/manifest.json'); */
export function createWorld(target: WorldTarget, options: WorldOptions = {}) {
  const canvas = resolveWorldTarget(target);
  const frames = createWorldFrames();
  const pools: Pools = {};
  let renderer: WorldRenderer | null = null,
    gpuDevice: GPUDevice | undefined,
    camera = new Camera('perspective'),
    toneMapping: ToneMapping = 'aces',
    exposure = 1,
    pixelError: number | undefined,
    bounce = false,
    models = 0,
    animating = false,
    disposed = false;
  const ready = probeWorldRenderer(canvas, options.renderer).then((granted) => {
    // A world disposed while its renderer was asked for keeps nothing it was granted.
    if (disposed) return granted.gpuDevice?.destroy();
    renderer = granted.renderer;
    gpuDevice = granted.gpuDevice;
  });
  ready.catch(() => {});
  const scene = new Scene(async (url: string, load: LoadOptions) => {
    await ready;
    // The one door for every model: its format is read from its content, then its loader —
    // today the compiled manifest's alone — reads it (`modelFormat.ts`).
    const read = {
      scope: load.scope === undefined ? undefined : load.scope === 'full' ? 'full' : 'slice',
      signal: load.signal ?? options.signal,
      textureSource: renderer === 'webgpu' && models++ === 0 ? 'cache' : 'host',
    } as const;
    return loadModelOfAnyFormat(url, read, { manifest: loadModel });
  });
  const invalidate = () => runtime.invalidate();
  const diagnostic = worldDiagnostic(() => runtime.explorer);
  const runtime = createWorldRuntime({
    canvas,
    ready,
    scene,
    camera: () => camera,
    options: () =>
      sessionOptions(options, {
        gpuDevice, // the world's one device: a new session never asks for another
        bounce,
        geometryPoolBytes: pools.geometryPool,
        texturePoolBytes: pools.texturePool,
        pixelError,
        clearColor: scene.background instanceof Color ? scene.background.getHex() : undefined,
        beforeFrame: () => {
          const delta = frames.delta();
          controls.update(delta);
          animating = advanceMixers(scene, delta);
          runtime.beforeFrame();
        },
        onFrame: (metrics) => {
          frames.dispatch(metrics);
          // A clip still playing asks for the next frame; the last one lets the loop pause.
          if (animating) invalidate();
        },
      }),
    opened(explorer) {
      renderer = explorer.backend === 'webgpu-page-raster' ? 'webgpu' : 'webgl2';
      diagnostic.apply(explorer);
    },
    frame: frames.dispatch,
    display: () => ({ exposure, toneMapping }),
    notices: diagnostic.notices,
    failed: (error) => console.error('World session failed to open', error),
  });
  /** The camera outside the scene still redraws when it moves. */
  const cameraLink: SceneLink = { pose: invalidate, structure: () => {}, content: () => {} };
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
      return renderer;
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
    /** The world's memory pools, read and set in bytes. */ budget: worldBudget(
      pools,
      () => runtime.explorer,
      () => frames.last,
    ),
    diagnostic: diagnostic.handle,
    /** Runs a function before every frame, with the frame's time. */ onFrame: frames.add,
    /** Another name for `onFrame`. */ loop: frames.add,
    /** Asks for a new frame after a change the world could not see. */ invalidate,
    /** Draws one frame now, whoever leads the loop. */
    render() {
      live();
      runtime.render();
    },
    /** Tells the world the canvas changed size; unset, it reads the canvas's own size.
     *  @param width - New width, CSS pixels. @param height - New height, CSS pixels. */
    resize(width = canvas.clientWidth, height = canvas.clientHeight) {
      live()?.resize(Math.floor(width), Math.floor(height));
      invalidate();
    },
    /** Per-step profile of the session's frames. */
    stageProfile: () => live()?.stageProfile() ?? null,
    /** Resolves once the pages the current view reads are resident (`awaitViewPages`). */
    awaitPages: () => awaitViewPages(runtime, live),
    /** Stops the world and gives back all it took: GPU memory, loop, controls. */ dispose() {
      if (disposed) return;
      disposed = true;
      controls.dispose();
      runtime.dispose();
      diagnostic.notices.close();
      frames.clear();
      gpuDevice?.destroy();
    },
  };
  registerWorld(world, { session: () => runtime.explorer, last: () => frames.last });
  return world;
}

/** What `createWorld` returns: one view. */ export type World = ReturnType<typeof createWorld>;
export type { FrameInfo, WorldTarget, WorldRenderer, LoadOptions, WorldOptions };
