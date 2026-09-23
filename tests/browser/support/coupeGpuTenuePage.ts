// Page side of the proof: the real WebGPU engine on a real cluster DAG, with a residency budget
// too small for its leaves. The kernel therefore wants missing pages, and the cut climbs to the
// resident ancestor — the very path where GPU selection used to be thrown away.
//
// Nothing is inspected from the inside: only the public counters `cpuSelectMs` (null while GPU
// cut still chooses) and `gpuSelectionFallback` (false while it has not been abandoned) decide.
import type {
  BackendDiagnostic,
  RenderBackend,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import {
  dagFixture,
  wideCamera,
} from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts';
import { ouvrirAppareil } from '../probes/appareilWebgpu.ts';

const IMAGES = 30;

/** `RenderBackend` does not declare `cpuFrameEnd` publicly; the object `webgpuPagesBackend`
 *  returns still carries it (`packages/sdk-browser/src/webgpu/pages/pages.ts`). Read here through a local
 *  extension of the public type rather than widening it in the engine. */
interface BackendAvecCpuFrameEnd extends RenderBackend {
  cpuFrameEnd?(): void;
}

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const evenements: Pick<BackendDiagnostic, 'phase' | 'message' | 'context'>[] = [];
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
    onDiagnostic: (e) =>
      evenements.push({ phase: e.phase, message: e.message, context: e.context }),
  });
  const camera = wideCamera(),
    images: {
      i: number;
      cpuSelectMs: number | null;
      gpuSelectionFallback: boolean | null;
      uncoveredTriangles: number | null;
      clusters: number | null;
      residentPages: number | null;
    }[] = [];
  if (!backend.flush) throw new Error('backend missing flush');
  const flush = backend.flush;
  const withCpuFrameEnd = backend as BackendAvecCpuFrameEnd;
  try {
    await backend.prepare();
    // Loading: pages requested by the cut arrive, then measurement begins.
    for (let i = 0; i < 4; i++) {
      backend.render(camera);
      await flush();
    }
    for (let i = 0; i < IMAGES; i++) {
      backend.render(camera);
      withCpuFrameEnd.cpuFrameEnd?.();
      await flush();
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
    const trace = error instanceof Error ? (error.stack ?? '') : '';
    return { erreur: String(error) + trace, images, evenements, erreurs };
  } finally {
    backend.dispose();
    canvas.remove();
    fixture.geometry.dispose();
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, images, evenements, erreurs };
}
