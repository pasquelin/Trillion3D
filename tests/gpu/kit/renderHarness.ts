// What the render proofs that open a compiled scene on Dawn share: the `three-stack` golden some of
// them compile, and the gallery scene others open — both read from disk, as the bench reads them.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFullCache } from '../../../scripts/native-compiler.ts';
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/world/session/explorer.ts';
import { manifestUrlOf } from '../../kit/scenes/caches.ts';
import { installProofGpu } from './onDawn.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

/** The measurement SDK the proofs open their worlds with, imported once Dawn is installed: its
 *  modules read the WebGPU globals as they load. */
export async function measurementSdk() {
  installProofGpu();
  return import('../../../bench/witnesses/measurement.ts');
}

/** A canvas of the page's document, `width` × `height` CSS pixels, under `id`. */
export function proofCanvas(id: string) {
  installProofGpu();
  const canvas = document.createElement('canvas');
  canvas.id = id;
  document.body.append(canvas);
  return canvas;
}

/** Compiles the `three-stack` coplanar golden into `<out>/cache` with the native compiler, and
 *  returns the addresses of its full manifest and of its objects folder. */
export function threeStackCache(out: string) {
  const fixture = resolve(ROOT, 'tests/fixtures/formats/coplanar/three-stack');
  compileFullCache({
    cwd: ROOT,
    source: fixture,
    cache: resolve(out, 'cache'),
    resourceBase: `${pathToFileURL(fixture).href}/`,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return {
    manifestUrl: pathToFileURL(resolve(out, 'cache/native/full/manifest.json')).href,
    objectsUrl: `${pathToFileURL(resolve(out, 'cache/native/objects')).href}/`,
  };
}

/** A gallery scene opened on the pages backend, full scope and imported lights, in a canvas of
 *  its own at `pixelRatio`, then posed. */
export interface GalleryScene {
  id: string;
  width: number;
  height: number;
  pixelRatio: number;
  /** The scene folder, relative to the repository root, under a scene root. */
  folder: string;
  texturePoolBytes: number;
  position: [number, number, number];
  target: [number, number, number];
}

export async function openGalleryScene(scene: GalleryScene): Promise<MeasuredWorld> {
  const { openMeasuredWorld, webgpuPagesBackend } = await measurementSdk();
  proofCanvas(scene.id);
  const world: MeasuredWorld = await openMeasuredWorld(scene.id, {
    manifestUrl: pathToFileURL(resolve(ROOT, manifestUrlOf(scene.folder).slice(1))).href,
    scope: 'full',
    importedLights: true,
    interactive: false,
    backends: [webgpuPagesBackend],
    width: scene.width,
    height: scene.height,
    pixelRatio: scene.pixelRatio,
    temporalAntialiasing: false,
    geometryPoolBytes: 16 * 1024 * 1024,
    geometryPoolCeilingBytes: 64 * 1024 * 1024,
    texturePoolBytes: scene.texturePoolBytes,
  });
  await world.awaitPages();
  world.setPose({ ...world.homePose(), position: scene.position, target: scene.target });
  return world;
}
