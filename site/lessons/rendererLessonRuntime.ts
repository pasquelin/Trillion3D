import { applyLightingLesson, createLightingLessonSession } from './lightingLessonRuntime.ts';
import { applyCameraLesson } from './cameraLessonRuntime.ts';
import { configureSceneCamera } from './engine-scene/cameraControls.ts';
import { createLessonWorld, type Engine } from './lessonWorld.ts';
import { addSceneFillLight } from './sceneFillLight.ts';
import { applyRendererLesson } from './rendererLessonApply.ts';
import { createRendererLessonDeadline } from './rendererLessonDeadline.ts';
import { createReadyGate } from './rendererLessonReadyGate.ts';
import { createShadowPageCounter } from './lessonShadowPages.ts';
import { isDiagnosticMode } from './engine-scene/diagnosticModes.ts';
import type { Light, World } from '../../packages/sdk-browser/index.ts';
import type {
  RendererLessonRuntimeOptions,
  RendererLessonSession,
} from './rendererLessonSessionTypes.ts';
export { applyRendererLesson } from './rendererLessonApply.ts';

const SETTLE_TIME_LIMIT_MS = 30_000,
  IDLE_AFTER_MS = 200;

export async function createRendererLessonRuntime({
  canvas,
  lesson,
  state,
  report,
  signal,
}: RendererLessonRuntimeOptions): Promise<RendererLessonSession> {
  const startup = createRendererLessonDeadline(signal, SETTLE_TIME_LIMIT_MS);
  // A static value import of the engine here would pull it into every route that reaches a
  // lesson, even one whose world never mounts (a server-rendered component pass, for one).
  const engine: Engine = await import('../../packages/sdk-browser/index.ts');
  let world: World, bounds: Awaited<ReturnType<typeof createLessonWorld>>['bounds'];
  try {
    ({ world, bounds } = await startup.wait(
      createLessonWorld({
        canvas,
        signal: startup.signal,
        manifest: lesson.manifest,
        importedLights: lesson.importedLights,
        engine,
      }),
    ));
  } catch (error) {
    startup.finish();
    throw error;
  }
  let disposed = false,
    idleTimer: ReturnType<typeof setTimeout> | undefined,
    resize: ResizeObserver | undefined,
    previous = 0,
    updateChain = Promise.resolve();
  const home = engine.pose.fromBounds(bounds),
    camera = configureSceneCamera(engine.pose, world, bounds),
    lessonLight: { current: Light | undefined } = { current: undefined },
    lighting = createLightingLessonSession(),
    shadows = createShadowPageCounter(),
    gate = createReadyGate();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    startup.cancel();
    gate.settleReject(new DOMException('Cancelled', 'AbortError'));
    clearTimeout(idleTimer);
    unsubscribe?.();
    resize?.disconnect();
    world.dispose();
    signal?.removeEventListener('abort', dispose);
  };
  startup.signal.addEventListener('abort', dispose, { once: true });
  signal?.addEventListener('abort', dispose, { once: true });
  // The world settles on its own (it stops drawing once the image is stable); this lesson only
  // has to notice the gap between frames to know a settle happened.
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      report({ fps: null, memory: null, triangles: null, idle: true });
      gate.settleResolve();
    }, IDLE_AFTER_MS);
  };
  const unsubscribe = world.onFrame(({ metrics }) => {
    if (disposed) return;
    clearTimeout(idleTimer);
    const now = performance.now();
    report({
      fps: previous ? 1000 / (now - previous) : null,
      cpu: metrics.cpuFrameMs,
      memory: null,
      triangles: metrics.selectedTriangles,
      shadowPages: shadows.observe(metrics),
      diagnostic: isDiagnosticMode(world.diagnostic.mode) ? world.diagnostic.mode : undefined,
      idle: false,
    });
    previous = now;
    armIdle();
  });
  const update = async (next: Record<string, number>) => {
    if (disposed) return;
    if (lesson.runtime === 'advanced-lighting')
      applyLightingLesson(engine.light, world, lesson, next, lighting);
    else if (lesson.runtime === 'camera-pose') applyCameraLesson(world, home, lesson, next);
    else applyRendererLesson(engine.light, world, lesson, next, lessonLight);
    shadows.reset();
    world.invalidate();
  };
  try {
    gate.nextReady();
    if (lesson.sceneLight)
      world.scene.add(
        engine.light.directional({
          position: [4.8, 9.6, 3.6],
          target: [0, 0, 0],
          color: [1, 0.92, 0.78],
          intensity: 2.5,
          castShadow: true,
        }),
      );
    if (lesson.sceneFill) addSceneFillLight(engine.light, world);
    const reset = () => {
      if (lesson.initialPose) {
        world.camera.position.set(...lesson.initialPose.position);
        world.camera.lookAt(...lesson.initialPose.target);
      } else camera.zoomOut();
      world.invalidate();
    };
    camera.reset();
    await startup.wait(update(state));
    const resizeCanvas = () => {
      if (disposed) return;
      world.resize();
      world.invalidate();
    };
    resize = new ResizeObserver(resizeCanvas);
    resize.observe(canvas);
    resizeCanvas();
    reset();
    await startup.wait(gate.current);
    startup.finish();
    return {
      update: (next) => {
        const run = async () => {
          if (disposed) throw new DOMException('Cancelled', 'AbortError');
          const settled = gate.nextReady();
          await update(next);
          await settled;
        };
        updateChain = updateChain.then(run, run);
        return updateChain;
      },
      dispose,
      setDiagnostic(mode) {
        if (!disposed) {
          world.diagnostic.mode = mode;
          world.invalidate();
        }
      },
      camera: {
        zoomIn: camera.zoomIn,
        zoomOut: camera.zoomOut,
        reset,
      },
    };
  } catch (error) {
    dispose();
    startup.finish();
    throw error;
  }
}
