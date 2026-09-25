/** The folders whose scenes keep a compiled cache beside their committed source, which git never
 *  tracks (`scripts/site-caches.ts` compiles them, `.gitignore` names them). */
export const SCENE_ROOTS = ['site/assets', 'tests/fixtures/scenes'] as const;

/** Glob patterns, from the repository root, of `file` in every compiled scene cache. */
export const inSceneCaches = (file: string) =>
  SCENE_ROOTS.map((root) => `${root}/**/cache/native/full/${file}`);
