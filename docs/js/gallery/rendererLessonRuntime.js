import { applyLightingLesson, createLightingLessonSession } from './lightingLessonRuntime.js';
import { applyCameraLesson } from './cameraLessonRuntime.js';
import { configureSceneCamera } from '../engine-scene/cameraControls.js';
import { createLessonExplorer } from './lessonExplorer.js';
import { addSceneFillLight } from '../sceneFillLight.js';

function lightFor(kind, state) {
  if (kind === 'point')
    return {
      id: 'lesson',
      kind,
      position: [0, 4, 2],
      color: [1, 0.72, 0.42],
      intensity: state.intensity,
      range: state.range,
      emitterRadius: 0.1,
      castsShadow: true,
    };
  if (kind === 'spot')
    return {
      id: 'lesson',
      kind,
      position: [0, 5, 4],
      direction: [0, -0.8, -0.6],
      color: [0.55, 0.75, 1],
      intensity: state.intensity,
      range: 12,
      coneAngle: (state.cone * Math.PI) / 180,
      emitterRadius: 0.1,
      castsShadow: true,
    };
  const angle = ((state.angle ?? -35) * Math.PI) / 180;
  return {
    id: 'lesson',
    kind: 'directional',
    direction: [Math.sin(angle), -0.8, Math.cos(angle)],
    color: [1, 0.92, 0.78],
    intensity: state.intensity ?? 2.5,
    castsShadow: true,
  };
}

export function applyRendererLesson(explorer, lesson, state, added) {
  if (['point', 'spot', 'directional', 'exposure'].includes(lesson.kind)) {
    const light = lightFor(lesson.kind === 'exposure' ? 'directional' : lesson.kind, state);
    if (added.value) {
      const { id, ...patch } = light;
      explorer.setLight(id, patch);
    } else {
      explorer.addLight(light);
      added.value = true;
    }
  }
  if (lesson.kind === 'exposure') explorer.setEnvironment({ exposure: state.exposure });
  if (lesson.kind === 'lod') explorer.setPixelError(state.pixelError);
  if (lesson.kind === 'memory')
    return explorer.setMemoryBudgets({ geometryPoolBytes: state.geometryMiB * 1024 * 1024 });
}

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
    frame = 0,
    remaining = 0,
    previous = 0,
    resize,
    controls,
    readyResolve,
    readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const added = { value: false },
    lighting = createLightingLessonSession();
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
  const draw = (now) => {
    frame = 0;
    if (disposed) return;
    const metrics = explorer.render();
    const idle = --remaining <= 0;
    report({
      fps: !idle && previous ? 1000 / (now - previous) : null,
      cpu: metrics.cpuFrameMs,
      memory: metrics.geometryPoolAllocatedBytes,
      triangles: metrics.drawnTriangles,
      idle,
    });
    readyResolve?.();
    readyResolve = undefined;
    readyReject = undefined;
    previous = now;
    if (!idle) frame = requestAnimationFrame(draw);
  };
  const invalidate = () => {
    if (disposed) return;
    remaining = 24;
    previous = 0;
    if (!frame) frame = requestAnimationFrame(draw);
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
      camera.zoomOut();
      invalidate();
    };
    reset();
    controls.addEventListener('change', invalidate);
    await update(state);
    resize = new ResizeObserver(() => {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      explorer.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
      invalidate();
    });
    resize.observe(canvas);
    await ready;
    return {
      update,
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
