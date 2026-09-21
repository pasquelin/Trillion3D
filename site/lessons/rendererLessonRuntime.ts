import { applyLightingLesson, createLightingLessonSession } from './lightingLessonRuntime.ts';
import { applyCameraLesson } from './cameraLessonRuntime.ts';
import { configureSceneCamera } from './engine-scene/cameraControls.ts';
import { createLessonExplorer } from './lessonExplorer.ts';
import { addSceneFillLight } from './sceneFillLight.ts';
import { applyRendererLesson } from './rendererLessonApply.ts';
import { createRendererLessonDeadline } from './rendererLessonDeadline.ts';
export { applyRendererLesson } from './rendererLessonApply.ts';

const COLD_FRAME_LIMIT = 2400,
  INTERACTIVE_FRAME_LIMIT = 24,
  SETTLE_MINIMUM_MS = 2_000,
  SETTLE_TIME_LIMIT_MS = 30_000;

export async function createRendererLessonRuntime({ canvas, lesson, state, report, signal }) {
  const startup = createRendererLessonDeadline(signal, SETTLE_TIME_LIMIT_MS);
  const importedLights =
    lesson.importedLights ??
    (['lod', 'memory', 'offline'].includes(lesson.kind) || lesson.runtime === 'camera-pose');
  let explorer;
  try {
    const opts = { canvas, signal: startup.signal, manifest: lesson.manifest, importedLights };
    explorer = await startup.wait(createLessonExplorer(opts));
  } catch (error) {
    startup.finish();
    throw error;
  }
  let disposed = false,
    starting = true,
    coldStart = lesson.kind === 'lod-diagnostic',
    frame = 0,
    remaining = 0,
    settleNotBefore = 0,
    previous = 0,
    resize,
    controls,
    ready,
    readyResolve,
    readyReject,
    updateChain = Promise.resolve();
  const added = { value: false },
    lighting = createLightingLessonSession();
  const nextReady = () => {
    ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    ready.catch(() => {});
    return ready;
  };
  const settle = (outcome, value) => {
    outcome?.(value);
    readyResolve = readyReject = undefined;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    startup.cancel();
    settle(readyReject, new DOMException('Cancelled', 'AbortError'));
    cancelAnimationFrame(frame);
    resize?.disconnect();
    controls?.dispose();
    explorer.dispose();
    signal?.removeEventListener('abort', dispose);
  };
  startup.signal.addEventListener('abort', dispose, { once: true });
  signal?.addEventListener('abort', dispose, { once: true });
  const draw = async () => {
    try {
      await startup.wait(explorer.awaitPages());
      if (disposed) return;
      const metrics = explorer.render();
      await startup.wait(explorer.flush());
      if (disposed) return;
      const now = performance.now(),
        settled = now >= settleNotBefore && metrics.frameHeld && (metrics.pagesLoading ?? 0) === 0,
        exhausted = --remaining <= 0,
        idle = coldStart ? settled || exhausted : exhausted;
      report({
        fps: !idle && previous ? 1000 / (now - previous) : null,
        cpu: metrics.cpuFrameMs,
        memory: metrics.geometryPoolAllocatedBytes,
        triangles: metrics.drawnTriangles,
        occluded: metrics.hizRejectedClusters ?? null, // the device's count, never estimated
        tested: metrics.hizTestedClusters ?? null,
        diagnostic: explorer.diagnostic,
        idle,
      });
      if (!coldStart) settle(readyResolve);
      previous = now;
      frame = 0;
      if (idle) settle(readyResolve);
      else frame = requestAnimationFrame(draw);
    } catch (error) {
      frame = 0;
      settle(readyReject, error);
      dispose();
    }
  };
  const invalidate = () => {
    if (disposed) return;
    remaining = coldStart ? COLD_FRAME_LIMIT : INTERACTIVE_FRAME_LIMIT;
    settleNotBefore = performance.now() + (coldStart ? SETTLE_MINIMUM_MS : 0);
    previous = 0;
    if (!starting && !frame) frame = requestAnimationFrame(draw);
  };
  const update = async (next) => {
    if (disposed) return;
    if (lesson.runtime === 'advanced-lighting')
      applyLightingLesson(explorer, lesson, next, lighting);
    else if (lesson.runtime === 'camera-pose') applyCameraLesson(explorer, lesson, next);
    else await applyRendererLesson(explorer, lesson, next, added);
    invalidate();
  };
  try {
    await startup.wait(explorer.awaitPages());
    if (disposed) throw new DOMException('Cancelled', 'AbortError');
    nextReady();
    if (lesson.sceneLight)
      explorer.addLight({
        id: 'scene',
        kind: 'directional',
        direction: [-0.4, -0.8, -0.3],
        color: [1, 0.92, 0.78],
        intensity: 2.5,
        castsShadow: true,
      });
    if (lesson.sceneFill) addSceneFillLight(explorer);
    controls = explorer.controls();
    const camera = configureSceneCamera(explorer, controls);
    const reset = () => {
      camera.reset();
      if (lesson.initialPose) {
        const home = explorer.homePose();
        explorer.setPose({ ...home, ...lesson.initialPose });
        controls.target.fromArray(lesson.initialPose.target);
        controls.update();
      } else camera.zoomOut();
      invalidate();
    };
    controls.addEventListener('change', invalidate);
    await startup.wait(update(state));
    const resizeCanvas = () => {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      explorer.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
      invalidate();
    };
    resize = new ResizeObserver(resizeCanvas);
    resize.observe(canvas);
    resizeCanvas();
    starting = false;
    reset();
    await startup.wait(ready);
    if (lesson.kind === 'lod-diagnostic') {
      nextReady();
      await startup.wait(update({ ...state, pixelError: 0 }));
      await startup.wait(ready);
      nextReady();
      await startup.wait(update(state));
      await startup.wait(ready);
    }
    coldStart = false;
    startup.finish();
    return {
      update: (next) => {
        const run = async () => {
          if (disposed) throw new DOMException('Cancelled', 'AbortError');
          const settled = nextReady();
          await update(next);
          await settled;
        };
        updateChain = updateChain.then(run, run);
        return updateChain;
      },
      dispose,
      setDiagnostic(mode) {
        if (!disposed) {
          explorer.setDiagnostic(mode);
          invalidate();
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
