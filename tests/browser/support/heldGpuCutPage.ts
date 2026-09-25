// Page side of the proof: the real WebGPU engine on a real cluster DAG, with a residency budget
// too small for its leaves. The kernel therefore wants missing pages, and the cut climbs to the
// resident ancestor — the very path where GPU selection used to be thrown away.
//
// Nothing is inspected from the inside: the public counters `cpuSelectMs` (null while GPU cut
// still chooses) and `gpuSelectionFallback` (false while it has not been abandoned), and the drawn
// cut the engine publishes (`selectedPageIds`), whose coverage the proof checks leaf by leaf.
import type {
  BackendDiagnostic,
  RenderBackend,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import {
  dagFixture,
  wideCamera,
} from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts';
import { ouvrirAppareil } from '../probes/webgpuDevice.ts';

const IMAGES = 30;

/** The fixture strip runs along x from -2 to 2, one leaf per unit: the units each page spans. */
type PageSpan = { url: string; units: [number, number] };
const spansOf = (pages: readonly { url: string; min: number[]; max: number[] }[]): PageSpan[] =>
  pages.map((page) => ({ url: page.url, units: [page.min[0] + 2, page.max[0] + 2] }));

/** `RenderBackend` declares neither `cpuFrameEnd` nor `selectedPageIds` publicly; the object
 *  `webgpuPagesBackend` returns still carries them (`packages/sdk-browser/src/webgpu/pages/pages.ts`).
 *  Read here through a local extension of the public type rather than widening it in the engine. */
interface BackendDeLaPreuve extends RenderBackend {
  cpuFrameEnd?(): void;
  selectedPageIds(): string[];
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
      drawn: string[];
      clusters: number | null;
      residentPages: number | null;
    }[] = [];
  if (!backend.flush) throw new Error('backend missing flush');
  const flush = backend.flush;
  const engine = backend as BackendDeLaPreuve;
  try {
    await backend.prepare();
    // Loading: pages requested by the cut arrive, then measurement begins.
    for (let i = 0; i < 4; i++) {
      backend.render(camera);
      await flush();
    }
    for (let i = 0; i < IMAGES; i++) {
      backend.render(camera);
      engine.cpuFrameEnd?.();
      await flush();
      const m = backend.metrics();
      images.push({
        i,
        cpuSelectMs: m.cpuSelectMs ?? null,
        gpuSelectionFallback: m.gpuSelectionFallback ?? null,
        drawn: engine.selectedPageIds(),
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
  const pages = spansOf(fixture.metadata.primitives[0].pages);
  return { adaptateur: info.court, pages, images, evenements, erreurs };
}
