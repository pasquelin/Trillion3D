import { lessonCode } from './lessonCode.ts';
function change(lesson, state) {
  if (lesson.mode === 'dolly')
    return `pose.position = pose.target.map((value, index) => value + (pose.position[index] - value) * ${state.distance});`;
  if (lesson.mode === 'fov') return `pose.fov = ${state.fov};`;
  if (lesson.mode === 'near') return `pose.near = ${state.near};`;
  return `const angle = ${state.angle} * Math.PI / 180;
const dx = pose.position[0] - pose.target[0];
const dz = pose.position[2] - pose.target[2];
const radius = Math.hypot(dx, dz);
pose.position = [pose.target[0] + Math.sin(angle) * radius, ${state.height ?? 'pose.position[1]'}, pose.target[2] + Math.cos(angle) * radius];`;
}

export function cameraLessonCode(lesson, state) {
  return lessonCode(
    `const pose = explorer.homePose();\n${change(lesson, state)}\nexplorer.setPose(pose);`,
    {
      manifest: lesson.manifest,
      importedLights: lesson.importedLights,
      sceneLight: lesson.sceneLight,
      sceneFill: lesson.sceneFill,
    },
  );
}
