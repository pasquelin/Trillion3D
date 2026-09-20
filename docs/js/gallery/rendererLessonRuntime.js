import { applyLightingLesson, createLightingLessonSession } from './lightingLessonRuntime.js';
import { applyCameraLesson } from './cameraLessonRuntime.js';
import { configureSceneCamera } from '../engine-scene/cameraControls.js';
import { createLessonExplorer } from './lessonExplorer.js';
import { addSceneFillLight } from '../sceneFillLight.js';
import { applyRendererLesson } from './rendererLessonApply.js';
export { applyRendererLesson } from './rendererLessonApply.js';

const COLD_FRAME_LIMIT = 2400,
  INTERACTIVE_FRAME_LIMIT = 24,
  SETTLE_MINIMUM_MS = 2_000,
  SETTLE_TIME_LIMIT_MS = 30_000;

export async function createRendererLessonRuntime({ canvas, lesson, state, report, signal }) {
  const importedLights =
    lesson.importedLights ??
    (['lod', 'memory', 'offline'].includes(lesson.kind) || lesson.runtime === 'camera-pose');
  const explorer = await createLessonExplorer({
    canvas,
    signal,
    manifest: lesson.manifest,
    importedLights,
  });
  let disposed = false,
    starting = true,
    coldStart = lesson.kind === 'lod-diagnostic',
    frame = 0,
    remaining = 0,
    settleNotBefore = 0,
    settleDeadline = 0,
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
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    readyReject?.(new DOMException('Cancelled', 'AbortError'));
    readyResolve = undefined;
    readyReject = undefined;
    cancelAnimationFrame(frame);
    resize?.disconnect();
    controls?.dispose();
    explorer.dispose();
    signal?.removeEventListener('abort', dispose);
  };
  if (signal?.aborted) {
    dispose();
    throw new DOMException('Cancelled', 'AbortError');
  }
  signal?.addEventListener('abort', dispose, { once: true });
  const draw = async () => {
    try {
      await explorer.awaitPages();
      if (disposed) return;
      const metrics = explorer.render();
      await explorer.flush();
      if (disposed) return;
      const now = performance.now(),
        settled = now >= settleNotBefore && metrics.frameHeld && (metrics.pagesLoading ?? 0) === 0,
        exhausted = --remaining <= 0,
        idle = coldStart ? settled || exhausted || now >= settleDeadline : exhausted;
      report({
        fps: !idle && previous ? 1000 / (now - previous) : null,
        cpu: metrics.cpuFrameMs,
        memory: metrics.geometryPoolAllocatedBytes,
        triangles: metrics.drawnTriangles,
        idle,
      });
      if (!coldStart) {
        readyResolve?.();
        readyResolve = undefined;
        readyReject = undefined;
      }
      previous = now;
      frame = 0;
      if (idle) {
        readyResolve?.();
        readyResolve = undefined;
        readyReject = undefined;
      } else frame = requestAnimationFrame(draw);
    } catch (error) {
      frame = 0;
      readyReject?.(error);
      readyResolve = undefined;
      readyReject = undefined;
      dispose();
    }
  };
  const invalidate = () => {
    if (disposed) return;
    remaining = coldStart ? COLD_FRAME_LIMIT : INTERACTIVE_FRAME_LIMIT;
    settleNotBefore = performance.now() + (coldStart ? SETTLE_MINIMUM_MS : 0);
    settleDeadline = performance.now() + SETTLE_TIME_LIMIT_MS;
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
    await explorer.awaitPages();
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
    await update(state);
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
    await ready;
    if (lesson.kind === 'lod-diagnostic') {
      nextReady();
      await update({ ...state, pixelError: 0 });
      await ready;
      nextReady();
      await update(state);
      await ready;
    }
    coldStart = false;
    return {
      update: (next) => {
        const run = async () => {
          const settled = nextReady();
          await update(next);
          await settled;
        };
        updateChain = updateChain.then(run, run);
        return updateChain;
      },
      dispose,
      camera: {
        zoomIn: camera.zoomIn,
        zoomOut: camera.zoomOut,
        reset,
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
