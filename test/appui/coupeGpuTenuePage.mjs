// Page side of the proof: the real WebGPU engine on a real cluster DAG, with a residency budget
// too small for its leaves. The kernel therefore wants missing pages, and the cut climbs to the
// resident ancestor — the very path where GPU selection used to be thrown away.
//
// Nothing is inspected from the inside: only the public counters `cpuSelectMs` (null while GPU
// cut still chooses) and `gpuSelectionFallback` (false while it has not been abandoned) decide.
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { dagFixture, wideCamera } from '../../packages/sdk-browser/pageSelectionDagFixture.ts';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';

const IMAGES = 30;

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const evenements = [];
  const fixture = dagFixture();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const backend = webgpuPagesBackend({
    source: fixture.source,
    metadata: fixture.metadata,
    indices: fixture.indices,
    associations: fixture.associations,
    gpuDevice: device,
    gpuCanvas: canvas,
    // Too few for the four leaves AND the two nodes that replace them: the cut climbs to the
    // resident ancestor every frame, and falls back to root coverage if needed.
    maxResidentPages: 2,
    viewport: [128, 128],
    pixelError: 0,
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
    onDiagnostic: (e) => evenements.push({ phase: e.phase, message: e.message }),
  });
  const camera = wideCamera(),
    images = [];
  try {
    await backend.prepare();
    // Loading: pages requested by the cut arrive, then measurement begins.
    for (let i = 0; i < 4; i++) {
      backend.render(camera);
      await backend.flush();
    }
    for (let i = 0; i < IMAGES; i++) {
      backend.render(camera);
      backend.cpuFrameEnd?.();
      await backend.flush();
      const m = backend.metrics();
      images.push({
        i,
        cpuSelectMs: m.cpuSelectMs ?? null,
        gpuSelectionFallback: m.gpuSelectionFallback ?? null,
        uncoveredTriangles: m.uncoveredTriangles ?? null,
        clusters: m.clusters ?? null,
        residentPages: m.residentPages ?? null,
      });
    }
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), images, evenements, erreurs };
  } finally {
    backend.dispose();
    canvas.remove();
    fixture.geometry.dispose();
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, images, evenements, erreurs };
}
