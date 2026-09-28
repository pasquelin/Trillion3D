// What the "real engine in Chromium" proofs share: pack a page module with esbuild, run it in a
// local page with a real WebGPU device, and return what the page answered, errors included.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from '../probes/pageWebgpu.ts';

const directory = dirname(fileURLToPath(import.meta.url));

/** One entry of the `evenements` array a page result reports diagnostics through. */
interface PageProofEvent {
  phase: string;
  context?: { reason?: string };
}

/** The page-result shape every proof of this kind asserts on (`preuveSaine`), whatever else the
 *  page adds beside it — `dansPageWebgpu` serialises the page's return value as JSON. */
export interface ResultatPagePreuve {
  indisponible?: string | null;
  erreur?: string | null;
  erreurs?: string[];
  evenements?: PageProofEvent[];
}

/** Target of the call `dansPageWebgpu` runs inside the page: a global installed by the bundle,
 *  under the name it was bundled as, with the method the proof asks to run. */
type PageTarget = { name: string; method: string };
type ModuleBundle = Record<string, () => unknown>;
type BundleWindow = typeof globalThis & Record<string, ModuleBundle>;

/**
 * Runs `method()` of the page module `fixture` in Chromium — `executer` by default, the name the
 * engine pages carry. `name` is the global name the bundle exposes itself under, `title` that of
 * the page. Returns the page result, its `erreurs` array completed by uncaught document errors.
 */
export async function preuveDansLaPage(
  fixture: string,
  name: string,
  title: string,
  method = 'executer',
  workerUrls = false,
): Promise<ResultatPagePreuve> {
  const script = await empaquetePage(resolve(directory, fixture), name, { workerUrls });
  const resources = workerUrls
    ? {
        '/pageDecodeWorker.js': await empaquetePage(
          resolve(directory, '../../../packages/sdk-browser/src/page/decode/pageDecodeWorker.ts'),
          undefined,
          { format: 'esm' },
        ),
      }
    : undefined;
  const pageErrors: string[] = [];
  const result = (await dansPageWebgpu(
    (target: PageTarget) => (globalThis as BundleWindow)[target.name][target.method](),
    { name, method },
    {
      titre: title,
      script,
      erreursPage: pageErrors,
      resources,
    },
  )) as ResultatPagePreuve;
  return { ...result, erreurs: [...(result.erreurs ?? []), ...pageErrors] };
}

/** Checks every proof of this kind must pass before examining its own reading. */
export function preuveSaine(result: ResultatPagePreuve): void {
  assert.equal(result.indisponible ?? null, null, String(result.indisponible));
  assert.equal(result.erreur ?? null, null, String(result.erreur));
  assert.deepEqual(result.erreurs, []);
  // An uncaptured GPU error is announced as a loss with that reason: a proof that provokes a
  // loss of its own still fails on one the engine's work caused.
  assert.ok(
    !(result.evenements ?? []).some(
      (event) => /failed/.test(event.phase) || event.context?.reason === 'uncaptured-error',
    ),
    JSON.stringify(result.evenements),
  );
}

/** Prints the adapter, the passes and the errors of a result that reports per-pass readings, then
 *  runs the checks every proof of this kind passes (`preuveSaine`). */
export function publieEtVerifie(
  result: ResultatPagePreuve & { adaptateur?: unknown; passes: unknown },
): void {
  console.log(
    JSON.stringify(
      {
        adaptateur: result.adaptateur ?? null,
        passes: result.passes,
        erreurs: result.erreurs,
      },
      null,
      2,
    ),
  );
  preuveSaine(result);
}
