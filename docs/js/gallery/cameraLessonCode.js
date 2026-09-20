function change(lesson, state) {
  if (lesson.mode === 'dolly')
    return `pose.position = pose.target.map((value, index) => value + (pose.position[index] - value) * ${state.distance});`;
  if (lesson.mode === 'fov') return `pose.fov = ${state.fov};`;
  if (lesson.mode === 'near') return `pose.near = ${state.near};`;
  return `const angle = ${state.angle} * Math.PI / 180;
const dx = pose.position[0] - pose.target[0];
const dz = pose.position[2] - pose.target[2];
const radius = Math.hypot(dx, dz);
pose.position = [pose.target[0] + Math.sin(angle) * radius, pose.position[1], pose.target[2] + Math.cos(angle) * radius];`;
}

export function cameraLessonCode(lesson, state) {
  return `import { createExplorer, webgpuPagesBackend } from './engine.js';

const explorer = await createExplorer(canvas, {
  manifestUrl: './assets/kinetic-garden/cache/native/full/manifest.json',
  scope: 'full', backends: [webgpuPagesBackend],
});
const pose = explorer.homePose();
${change(lesson, state)}
explorer.setPose(pose);
explorer.render();
// Call explorer.dispose() when the view is removed.`;
}
