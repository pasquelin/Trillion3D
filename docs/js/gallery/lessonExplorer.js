import { SCENE_BACKGROUND } from '../scenePalette.js';

export async function createLessonExplorer({ canvas, signal }) {
  const { createExplorer, webgpuPagesBackend } = await import('../../runtime/engine.js');
  const bounds = canvas.getBoundingClientRect();
  return createExplorer(canvas, {
    manifestUrl: new URL('assets/kinetic-garden/cache/native/full/manifest.json', document.baseURI)
      .href,
    scope: 'full',
    backends: [webgpuPagesBackend],
    importedLights: false,
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
