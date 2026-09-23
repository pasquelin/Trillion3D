import type { Box3, World } from '../../packages/sdk-browser/src/index.ts';
import { SCENE_BACKGROUND } from './scenePalette.ts';

/** The browser SDK's exports, loaded once by the caller and threaded in: a static value import
 *  here would pull the engine bundle into every route that reaches a lesson, even one that never
 *  mounts a world (`docs-gallery.test.ts`'s server-rendered pass never does). */
export type Engine = typeof import('../../packages/sdk-browser/src/index.ts');

export async function createLessonWorld({
  canvas,
  signal,
  manifest = 'assets/kinetic-garden/cache/native/full/manifest.json',
  importedLights,
  engine,
}: {
  canvas: HTMLCanvasElement;
  signal?: AbortSignal;
  manifest?: string;
  /** false removes the lights the source file carried once the model is in: the lesson drives
   *  light of its own and does not want the two mixed. */
  importedLights?: boolean;
  engine: Engine;
}): Promise<{ world: World; bounds: Box3 }> {
  const { createWorld, math } = engine;
  const world = createWorld(canvas, { pixelRatio: window.devicePixelRatio, signal });
  world.scene.background = math.color(SCENE_BACKGROUND.packed);
  try {
    const model = await world.scene.load(new URL(manifest, document.baseURI).href);
    if (importedLights === false) for (const l of [...model.lights]) model.remove(l);
    world.budget.geometryPool = 16 * 1024 * 1024;
    world.budget.texturePool = 128 * 1024 * 1024;
    return { world, bounds: model.bounds };
  } catch (error) {
    world.dispose();
    throw error;
  }
}
