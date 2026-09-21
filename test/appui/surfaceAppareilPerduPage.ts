// Page side of the "lost device" proof: the real WebGPU engine on the repository DAG fixture,
// presenting into a canvas of its own — the composed path, where a host copies that canvas. The
// device is then destroyed, and what a host could still read is checked: the canvas the engine
// published must be withdrawn and blank, the next render must raise `WEBGPU_LOST`, and the loss
// must have been announced under that name.
//
// Pixels are read the way a host reads them (`createSynchronousCanvasCapture`): before the loss
// the image must hold the fixture's triangles, so that a stale copy would have been visible.
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { createSynchronousCanvasCapture } from '../../packages/sdk-browser/gpuPresentation.ts';
import { dagFixture, wideCamera } from '../../packages/sdk-browser/pageSelectionDagFixture.ts';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.ts';

const litPixels = (pixels) => pixels.reduce((n, v, i) => (i % 4 !== 3 && v !== 0 ? n + 1 : n), 0);

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const evenements = [];
  const fixture = dagFixture();
  const backend = webgpuPagesBackend({
    source: fixture.source,
    metadata: fixture.metadata,
    indices: fixture.indices,
    associations: fixture.associations,
    gpuDevice: device,
    maxResidentPages: 8,
    viewport: [128, 128],
    pixelError: 0,
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
    onDiagnostic: (e) =>
      evenements.push({ phase: e.phase, message: e.message, context: e.context }),
  });
  const camera = wideCamera();
  let lecture;
  try {
    await backend.prepare();
    for (let i = 0; i < 4; i++) {
      backend.render(camera);
      await backend.flush();
    }
    const surface = backend.presentedSurface;
    if (!surface) return { erreur: 'no composed surface published', evenements, erreurs };
    lecture = createSynchronousCanvasCapture();
    const avant = litPixels(lecture.read(surface));
    device.destroy();
    await device.lost;
    // The engine's own reaction to the promise runs before this one; one more turn for safety.
    await Promise.resolve();
    const publiee = backend.presentedSurface !== undefined;
    const apres = litPixels(lecture.read(surface));
    let erreurRendu = null;
    try {
      backend.render(camera);
    } catch (error) {
      erreurRendu = String(error);
    }
    const perte = evenements.find((e) => e.phase === 'gpu-device-lost') ?? null;
    return {
      avant,
      apres,
      publiee,
      erreurRendu,
      frameHeld: backend.metrics().frameHeld ?? null,
      perte,
      evenements,
      erreurs,
    };
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), evenements, erreurs };
  } finally {
    lecture?.dispose();
    backend.dispose();
    fixture.geometry.dispose();
  }
}
