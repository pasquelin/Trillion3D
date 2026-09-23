// What the "real engine in Chromium" proofs share: pack a page module with esbuild, run it in a
// local page with a real WebGPU device, and return what the page answered, errors included.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from '../probes/pageWebgpu.ts';

const ici = dirname(fileURLToPath(import.meta.url));

/** One entry of the `evenements` array a page result reports diagnostics through. */
export interface EvenementPagePreuve {
  phase: string;
  context?: { reason?: string };
}

/** The page-result shape every proof of this kind asserts on (`preuveSaine`), whatever else the
 *  page adds beside it — `dansPageWebgpu` serialises the page's return value as JSON. */
export interface ResultatPagePreuve {
  indisponible?: string | null;
  erreur?: string | null;
  erreurs?: string[];
  evenements?: EvenementPagePreuve[];
}

/** Target of the call `dansPageWebgpu` runs inside the page: a global installed by the bundle,
 *  under the name it was bundled as, with the method the proof asks to run. */
type CiblePage = { nom: string; methode: string };
type ModuleBundle = Record<string, () => unknown>;
type FenetreAvecBundles = typeof globalThis & Record<string, ModuleBundle>;

/**
 * Runs `methode()` of the page module `fixture` in Chromium — `executer` by default, the name the
 * engine pages carry. `nom` is the global name the bundle exposes itself under, `titre` that of
 * the page. Returns the page result, its `erreurs` array completed by uncaught document errors.
 */
export async function preuveDansLaPage(
  fixture: string,
  nom: string,
  titre: string,
  methode = 'executer',
): Promise<ResultatPagePreuve> {
  const script = (await empaquetePage(resolve(ici, fixture), nom)) as string;
  const erreursPage: string[] = [];
  const resultat = (await dansPageWebgpu(
    (cible: CiblePage) => (globalThis as FenetreAvecBundles)[cible.nom][cible.methode](),
    { nom, methode },
    {
      titre,
      script,
      erreursPage,
    },
  )) as ResultatPagePreuve;
  return { ...resultat, erreurs: [...(resultat.erreurs ?? []), ...erreursPage] };
}

/** Checks every proof of this kind must pass before examining its own reading. */
export function preuveSaine(resultat: ResultatPagePreuve): void {
  assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
  assert.equal(resultat.erreur ?? null, null, String(resultat.erreur));
  assert.deepEqual(resultat.erreurs, []);
  // An uncaptured GPU error is announced as a loss with that reason: a proof that provokes a
  // loss of its own still fails on one the engine's work caused.
  assert.ok(
    !(resultat.evenements ?? []).some(
      (evenement) =>
        /failed/.test(evenement.phase) || evenement.context?.reason === 'uncaptured-error',
    ),
    JSON.stringify(resultat.evenements),
  );
}

/** Prints the adapter, the passes and the errors of a result that reports per-pass readings, then
 *  runs the checks every proof of this kind passes (`preuveSaine`). */
export function publieEtVerifie(
  resultat: ResultatPagePreuve & { adaptateur?: unknown; passes: unknown },
): void {
  console.log(
    JSON.stringify(
      {
        adaptateur: resultat.adaptateur ?? null,
        passes: resultat.passes,
        erreurs: resultat.erreurs,
      },
      null,
      2,
    ),
  );
  preuveSaine(resultat);
}
