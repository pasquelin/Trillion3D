import { rendererLessonBaseDefinitions } from './rendererLessonBaseDefinitions.ts';
import { lightingLessonDefinitions } from './lightingLessonDefinitions.ts';
import { cameraLessonDefinitions } from './cameraLessonDefinitions.ts';
import { occlusionLessonDefinition } from './occlusionLesson.ts';
import { offlineLessons } from './offline/lessons.ts';
import { rendererSceneFor } from './rendererSceneAssignments.ts';
import type { RendererLessonItem } from './rendererLessonTypes.ts';

const baseLessons: RendererLessonItem[] = [
  ...rendererLessonBaseDefinitions,
  ...lightingLessonDefinitions,
  ...cameraLessonDefinitions,
  occlusionLessonDefinition,
  ...offlineLessons,
];

export const rendererLessons: RendererLessonItem[] = baseLessons.map((lesson) =>
  lesson.kind === 'offline'
    ? { ...lesson, renderer: true }
    : rendererSceneFor({ ...lesson, renderer: true }),
);

export const rendererLessonById = (id: string) =>
  rendererLessons.find((lesson) => lesson.id === id);
export const rendererInitialState = (lesson: RendererLessonItem) =>
  Object.fromEntries(lesson.controls.map(({ id, value }) => [id, value]));
