import { SCENE_BACKGROUND } from './scenePalette.ts';

export async function createLessonExplorer({
  canvas,
  signal,
  manifest = 'assets/kinetic-garden/cache/native/full/manifest.json',
  importedLights = true,
}: {
  canvas: HTMLCanvasElement;
  signal?: AbortSignal;
  manifest?: string;
  importedLights?: boolean;
}) {
  const { createExplorer, webgpuPagesBackend } =
    await import('../../packages/sdk-browser/index.ts');
  const bounds = canvas.getBoundingClientRect();
  return createExplorer(canvas, {
    manifestUrl: new URL(manifest, document.baseURI).href,
    scope: 'full',
    backends: [webgpuPagesBackend],
    importedLights,
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    pixelRatio: window.devicePixelRatio,
    pixelError: 0,
    geometryPoolBytes: 16 * 1024 * 1024,
    geometryPoolCeilingBytes: 64 * 1024 * 1024,
    texturePoolBytes: 128 * 1024 * 1024,
    clearColor: SCENE_BACKGROUND.packed,
    diagnosticDetail: 'summary',
    signal,
  });
}
