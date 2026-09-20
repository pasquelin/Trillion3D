import { createLessonExplorer } from './lessonExplorer.js';

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

export async function createRendererLessonRuntime({ canvas, lesson, state, report }) {
  const explorer = await createLessonExplorer({ canvas });
  const added = { value: false };
  let disposed = false,
    frame = 0,
    remaining = 0,
    previous = 0;
  const draw = (now) => {
    frame = 0;
    if (disposed) return;
    const metrics = explorer.render();
    report({
      fps: previous ? 1000 / (now - previous) : null,
      cpu: metrics.cpuFrameMs,
      memory: metrics.geometryPoolAllocatedBytes,
      triangles: metrics.drawnTriangles,
    });
    previous = now;
    if (--remaining > 0) frame = requestAnimationFrame(draw);
    else
      report({
        ...metrics,
        fps: null,
        cpu: metrics.cpuFrameMs,
        memory: metrics.geometryPoolAllocatedBytes,
        triangles: metrics.drawnTriangles,
        idle: true,
      });
  };
  const invalidate = () => {
    remaining = 24;
    previous = 0;
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const update = async (next) => {
    await applyRendererLesson(explorer, lesson, next, added);
    invalidate();
  };
  await explorer.awaitPages();
  await update(state);
  const resize = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    explorer.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
    invalidate();
  });
  resize.observe(canvas);
  return {
    update,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      explorer.dispose();
    },
  };
}
