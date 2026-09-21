// What the "real engine in Chromium" proofs share: pack a page module with esbuild, run it in a
// local page with a real WebGPU device, and return what the page answered, errors included.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from '../justesse/pageWebgpu.mjs';

const ici = dirname(fileURLToPath(import.meta.url));

/**
 * Runs `methode()` of the page module `fixture` in Chromium — `executer` by default, the name the
 * engine pages carry. `nom` is the global name the bundle exposes itself under, `titre` that of
 * the page. Returns the page result, its `erreurs` array completed by uncaught document errors.
 */
export async function preuveDansLaPage(fixture, nom, titre, methode = 'executer') {
  const script = await empaquetePage(resolve(ici, fixture), nom);
  const erreursPage = [];
  const resultat = await dansPageWebgpu(
    (cible) => globalThis[cible.nom][cible.methode](),
    { nom, methode },
    {
      titre,
      script,
      erreursPage,
    },
  );
  return { ...resultat, erreurs: [...(resultat.erreurs ?? []), ...erreursPage] };
}

/** Checks every proof of this kind must pass before examining its own reading. */
export function preuveSaine(resultat) {
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
