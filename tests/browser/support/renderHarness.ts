// What the render proofs that open the built SDK in a page share: the mounts that serve it, the
// compiled `three-stack` golden some of them load, and the gallery scene others open.
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { compileFullCache } from '../../../scripts/native-compiler.ts';
import type { Mount } from '../../kit/server/staticServer.ts';
import type { MeasuredWorld } from '../../../packages/sdk-browser/src/world/session/explorer.ts';

// `window.scene` only exists in the page a proof evaluates code in, never in Node; declared here so
// the `page.evaluate` callbacks of the proofs that open a scene (type-checked, though they run in
// the browser) see it.
declare global {
  interface Window {
    scene: MeasuredWorld;
  }
}

/** The built SDK and the two libraries its import map names. */
export const sdkMounts = (root: string): Mount[] => [
  { prefix: '/sdk/', dir: resolve(root, 'dist') },
  { prefix: '/vendor/three/', dir: resolve(root, 'node_modules/three') },
  { prefix: '/vendor/meshoptimizer/', dir: resolve(root, 'node_modules/meshoptimizer') },
];

/** Compiles the `three-stack` coplanar golden into `<out>/cache` with the native compiler, and
 *  returns the mounts that serve it. */
export function threeStackMounts(root: string, out: string): Mount[] {
  const fixture = resolve(root, 'tests/fixtures/formats/coplanar/three-stack');
  compileFullCache({
    cwd: root,
    source: fixture,
    cache: resolve(out, 'cache'),
    resourceBase: '/fixture/',
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return [
    { prefix: '/cache/city/', dir: resolve(out, 'cache/native/full') },
    { prefix: '/cache/objects/', dir: resolve(out, 'cache/native/objects') },
    { prefix: '/fixture/', dir: fixture },
  ];
}

/** A gallery scene opened on the pages backend, full scope and imported lights, in a canvas of
 *  its own that replaces the page body, then posed; the world is left on `window.scene`. */
export interface GalleryScene {
  id: string;
  width: number;
  height: number;
  manifestUrl: string;
  texturePoolBytes: number;
  position: [number, number, number];
  target: [number, number, number];
}

export async function openGalleryScene(page: Page, scene: GalleryScene): Promise<void> {
  await page.evaluate(
    async ({ sdkUrl, scene }) => {
      document.body.replaceChildren();
      document.body.style.margin = '0';
      const canvas = document.createElement('canvas');
      canvas.id = scene.id;
      canvas.style.cssText = `width:${scene.width}px;height:${scene.height}px;display:block`;
      document.body.append(canvas);
      const { openMeasuredWorld, webgpuPagesBackend } = await import(sdkUrl);
      const world: MeasuredWorld = await openMeasuredWorld(scene.id, {
        manifestUrl: scene.manifestUrl,
        scope: 'full',
        importedLights: true,
        interactive: false,
        backends: [webgpuPagesBackend],
        width: scene.width,
        height: scene.height,
        pixelRatio: window.devicePixelRatio,
        temporalAntialiasing: false,
        geometryPoolBytes: 16 * 1024 * 1024,
        geometryPoolCeilingBytes: 64 * 1024 * 1024,
        texturePoolBytes: scene.texturePoolBytes,
      });
      window.scene = world;
      await world.awaitPages();
      world.setPose({ ...world.homePose(), position: scene.position, target: scene.target });
    },
    { sdkUrl: '/sdk/sdk-browser/src/measurement/measurement.js', scene },
  );
}
